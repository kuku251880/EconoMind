import { lazy, Suspense, useEffect, useState } from 'react'
import { errorMessage, fetchSeries } from './api'
import type { Filters, IndicatorCode, IndicatorSeries } from './api'
import { indicatorLabels, useLanguage } from './i18n'
import { retailBasis } from './retail'
import type { UiText } from './i18n'

const SeriesChart = lazy(() => import('./SeriesChart'))

export function ComparisonPanel({ filters, primary, codes }: {
  filters: Filters
  primary: IndicatorSeries
  codes: IndicatorCode[]
}) {
  const { t } = useLanguage()
  const others = codes.filter(code => code !== primary.code && code !== 'cpi' && !retailBasis(code))
  const [peer, setPeer] = useState<IndicatorCode>(others[0])
  const [mode, setMode] = useState<'amount' | 'share'>('amount')
  const [loaded, setLoaded] = useState<IndicatorSeries[] | null>(null)
  const [error, setError] = useState<UiText | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const needed = codes.filter(code => code !== primary.code && code !== 'cpi' && !retailBasis(code))
    Promise.all(needed.map(code => fetchSeries({ ...filters, code }, controller.signal)))
      .then(data => { if (!controller.signal.aborted) setLoaded(data) })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)) })
    return () => controller.abort()
  }, [codes, filters, primary.code])

  const series = [primary, ...(loaded ?? [])]
  const values = (code: IndicatorCode) => new Map(series.find(s => s.code === code)?.points.map(p => [p.period, p.value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')]))
  const left = values(primary.code), right = values(peer), gdp = values('gdp')
  const hasGDP = codes.includes('gdp')
  const periods = [...new Set([...left.keys(), ...right.keys()])].sort()
  const share = (value: string | undefined, total: string | undefined) =>
    value !== undefined && total !== undefined && Number(total) > 0 ? Number(value) / Number(total) * 100 : undefined
  const name = (code: IndicatorCode) => t(...indicatorLabels[code])
  const amount = t('亿元', '100 million yuan')
  const unit = mode === 'amount' ? amount : '%'
  const comparisonRows = periods.map(period => {
    const a = left.get(period), b = right.get(period), total = gdp.get(period)
    return { period, a, b, shareA: share(a, total), shareB: share(b, total) }
  })
  const line = (side: 'a' | 'b') => comparisonRows.flatMap(row => {
    const value = mode === 'amount' ? row[side] : row[side === 'a' ? 'shareA' : 'shareB']
    return value === undefined ? [] : [{ period: row.period, value: String(value) }]
  })
  const first = line('a'), second = line('b')
  const percent = (value?: number) => value === undefined ? '—' : value.toFixed(2) + '%'

  return <section className="panel my-5 min-w-0 p-5" aria-labelledby="comparison-title">
    <h2 id="comparison-title" className="text-lg font-semibold">{t('指标对比', 'Indicator comparison')}</h2>
    <div className="my-4 grid gap-3 sm:grid-cols-2">
      <label>{t('对比指标', 'Compare with')}<select aria-label={t('对比指标', 'Compare with')} value={peer} onChange={e => setPeer(e.target.value as IndicatorCode)}>
        {others.map(code => <option key={code} value={code}>{name(code)}</option>)}
      </select></label>
      {hasGDP && <label>{t('图表口径', 'Chart measure')}<select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
        <option value="amount">{t('当季金额', 'Quarterly amount')}</option>
        <option value="share">{t('占 GDP 比重', 'Share of GDP')}</option>
      </select></label>}
    </div>
    {hasGDP && <p className="text-sm text-stone-600">{t('占比 = 本指标金额 ÷ 同一数据集当季 GDP × 100%。缺少金额或有效分母时显示 —。', 'Share = indicator amount / GDP for the same dataset and quarter × 100%. A dash marks an unavailable amount or denominator.')}</p>}
    {error ? <p role="alert">{t(...error)}</p> : !loaded ? <p role="status">{t('正在读取对比数据…', 'Loading comparison…')}</p> : <>
      {(first.length > 0 || second.length > 0) && <Suspense fallback={null}>
        <SeriesChart points={first} unit={unit} name={name(primary.code)} label={t('指标对比', 'Indicator comparison')}
          comparisons={[{name: name(peer), points: second}]} />
      </Suspense>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums" aria-label={t('对比明细', 'Comparison details')}>
        <thead><tr><th>{t('季度', 'Quarter')}</th><th>{name(primary.code)} ({amount})</th><th>{name(peer)} ({amount})</th>
          {hasGDP && <><th>{name(primary.code)} · % GDP</th><th>{name(peer)} · % GDP</th></>}
        </tr></thead>
        <tbody>{comparisonRows.map(r => <tr key={r.period}><th scope="row">{r.period}</th><td>{r.a ?? '—'}</td><td>{r.b ?? '—'}</td>
          {hasGDP && <><td>{percent(r.shareA)}</td><td>{percent(r.shareB)}</td></>}
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>
}
