import { Suspense, lazy, useEffect, useState } from 'react'
import { errorMessage, fetchForecast } from './api'
import type { Filters, ForecastComparison } from './api'
import { displayUnit, useLanguage } from './i18n'
import type { UiText } from './i18n'

const SeriesChart = lazy(() => import('./SeriesChart'))
const displayNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 })

function format(value: string | null) {
  return value === null ? '—' : displayNumber.format(Number(value))
}

function ForecastResults({ result }: { result: ForecastComparison }) {
  const { t } = useLanguage()
  const unit = displayUnit(result.unit, t)
  const next = result.next_forecast
  return (
    <div className="mt-4 space-y-5">
      {result.evaluated_count > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums" aria-label={t("同批回测误差", "Backtest errors")}>
              <thead className="bg-[#eef3ee] text-stone-700">
                <tr><th scope="col">{t("方法", "Method")}</th><th scope="col">MAE</th><th scope="col">RMSE</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">{t("上一季度值基线", "Previous-quarter baseline")}</th><td>{format(result.baseline_metrics.mae)}</td><td>{format(result.baseline_metrics.rmse)}</td></tr>
                <tr><th scope="row">{t("线性趋势模型", "Linear trend model")}</th><td>{format(result.linear_metrics.mae)}</td><td>{format(result.linear_metrics.rmse)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-stone-600">{t(`同批回测 ${result.evaluated_count} 期，跳过 ${result.skipped_count} 条观测。误差单位为${unit}，数值越小越好。`, `Evaluated ${result.evaluated_count} quarters and skipped ${result.skipped_count} observations. Errors are in ${unit}; lower is better.`)}</p>
          <Suspense fallback={<p role="status">{t("正在加载回测图…", "Loading backtest chart…")}</p>}>
            <SeriesChart
              name={t("实际值", "Actual")} unit={unit} label={t("回测实际值与预测值", "Backtest actual and forecast values")}
              points={result.predictions.map(({ period, actual }) => ({ period, value: actual }))}
              comparisons={[
                { name: t("上一季度值基线", "Previous-quarter baseline"), points: result.predictions.map(({ period, baseline }) => ({ period, value: baseline })) },
                { name: t("线性趋势模型", "Linear trend model"), points: result.predictions.map(({ period, linear_trend }) => ({ period, value: linear_trend })) },
              ]}
            />
          </Suspense>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums" aria-label={t("逐期回测预测", "Quarter-by-quarter forecasts")}>
              <thead className="bg-[#eef3ee] text-stone-700">
                <tr><th scope="col">{t("季度", "Quarter")}</th><th scope="col">{t("实际值", "Actual")}</th><th scope="col">{t("基线预测", "Baseline forecast")}</th><th scope="col">{t("趋势预测", "Trend forecast")}</th></tr>
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
      ) : <p role="status" className="text-sm">{t("当前范围没有可比较的回测点。一次回测需要四个连续历史季度及其下一季度的实际值。", "No comparable backtest points in this range. Each prediction needs four consecutive prior quarters and an actual value in the target quarter.")}</p>}
      {next && (
        <div className="rounded-lg bg-[#eef3ee] p-4">
          <h3 className="font-semibold">{t("下一季度估计", "Next-quarter estimate")} · {next.period}</h3>
          <p className="mt-1 text-sm tabular-nums">
            {t("上一季度值基线", "Previous-quarter baseline")} {format(next.baseline)} {unit} · {t("线性趋势模型", "Linear trend model")} {format(next.linear_trend)} {unit}
          </p>
          <p className="mt-1 text-xs text-stone-600">{t("以所选范围最后一个观测季度为起点。这项估计没有纳入本次回测。", "This estimate follows the last observed quarter in the selected range and is excluded from the backtest.")}</p>
        </div>
      )}
    </div>
  )
}

export function ForecastPanel({ filters }: { filters: Filters }) {
  const { t } = useLanguage()
  const [result, setResult] = useState<ForecastComparison | null>(null)
  const [error, setError] = useState<UiText | null>(null)

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
      <h2 id="forecast-title" className="text-lg font-semibold">{t("季度预测比较", "Quarterly Forecast Comparison")}</h2>
      <p className="mt-1 text-sm text-stone-600">{t("每期用此前四个连续季度拟合趋势，与上一季度值基线在同一批季度上比较。", "The trend uses four consecutive prior quarters. Both methods are scored on the same target quarters.")}</p>
      {error && <p className="mt-4 text-sm text-red-800" role="alert">{t(...error)}</p>}
      {!error && !result && <p className="mt-4 text-sm" role="status">{t("正在计算回测结果…", "Calculating backtest results…")}</p>}
      {result && <ForecastResults result={result} />}
    </section>
  )
}
