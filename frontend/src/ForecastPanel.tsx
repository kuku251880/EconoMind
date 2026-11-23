import { Suspense, lazy, useEffect, useState } from 'react'
import { errorMessage, fetchForecast } from './api'
import type { Filters, ForecastComparison } from './api'

const SeriesChart = lazy(() => import('./SeriesChart'))
const displayNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 })

function format(value: string | null) {
  return value === null ? '—' : displayNumber.format(Number(value))
}

function ForecastResults({ result }: { result: ForecastComparison }) {
  const next = result.next_forecast
  return (
    <div className="mt-4 space-y-5">
      {result.evaluated_count > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums" aria-label="同批回测误差">
              <thead className="bg-[#eef3ee] text-stone-700">
                <tr><th scope="col">方法</th><th scope="col">MAE</th><th scope="col">RMSE</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">上一季度值基线</th><td>{format(result.baseline_metrics.mae)}</td><td>{format(result.baseline_metrics.rmse)}</td></tr>
                <tr><th scope="row">线性趋势模型</th><td>{format(result.linear_metrics.mae)}</td><td>{format(result.linear_metrics.rmse)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-stone-600">同批回测 {result.evaluated_count} 期，跳过 {result.skipped_count} 条观测。误差单位为{result.unit}，数值越小越好。</p>
          <Suspense fallback={<p role="status">正在加载回测图…</p>}>
            <SeriesChart
              name="实际值" unit={result.unit} label="回测实际值与预测值"
              points={result.predictions.map(({ period, actual }) => ({ period, value: actual }))}
              comparisons={[
                { name: '上一季度值基线', points: result.predictions.map(({ period, baseline }) => ({ period, value: baseline })) },
                { name: '线性趋势模型', points: result.predictions.map(({ period, linear_trend }) => ({ period, value: linear_trend })) },
              ]}
            />
          </Suspense>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums" aria-label="逐期回测预测">
              <thead className="bg-[#eef3ee] text-stone-700">
                <tr><th scope="col">季度</th><th scope="col">实际值</th><th scope="col">基线预测</th><th scope="col">趋势预测</th></tr>
              </thead>
              <tbody>
                {result.predictions.map((point) => (
                  <tr key={point.period}>
                    <th scope="row">{point.period}</th>
                    <td>{format(point.actual)}</td><td>{format(point.baseline)}</td><td>{format(point.linear_trend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <p role="status" className="text-sm">当前范围没有可比较的回测点。一次回测需要四个连续历史季度及其下一季度的实际值。</p>}
      {next && (
        <div className="rounded-lg bg-[#eef3ee] p-4">
          <h3 className="font-semibold">下一季度估计 · {next.period}</h3>
          <p className="mt-1 text-sm tabular-nums">
            上一季度值基线 {format(next.baseline)} {result.unit} · 线性趋势模型 {format(next.linear_trend)} {result.unit}
          </p>
          <p className="mt-1 text-xs text-stone-600">以所选范围最后一个观测季度为起点。这项估计没有纳入本次回测。</p>
        </div>
      )}
    </div>
  )
}

export function ForecastPanel({ filters }: { filters: Filters }) {
  const [result, setResult] = useState<ForecastComparison | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchForecast(filters, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResult(data) },
      (failure: unknown) => { if (!controller.signal.aborted) setError(errorMessage(failure)) },
    )
    return () => controller.abort()
  }, [filters])

  return (
    <section className="panel mt-5 p-5" aria-labelledby="forecast-title">
      <h2 id="forecast-title" className="text-lg font-semibold">季度预测比较</h2>
      <p className="mt-1 text-sm text-stone-600">每期用此前四个连续季度拟合趋势，与上一季度值基线在同一批季度上比较。</p>
      {error && <p className="mt-4 text-sm text-red-800" role="alert">{error}</p>}
      {!error && !result && <p className="mt-4 text-sm" role="status">正在计算回测结果…</p>}
      {result && <ForecastResults result={result} />}
    </section>
  )
}
