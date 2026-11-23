import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { currentAccount, errorMessage, fetchSeries, logout } from './api'
import type { Account, DatasetRecord, Filters, IndicatorCode, IndicatorSeries } from './api'
import { AccountForm } from './AccountForm'
import { DatasetWorkspace } from './DatasetWorkspace'
import { ForecastPanel } from './ForecastPanel'
import { ResearchPanel } from './ResearchPanel'
import { displayUnit, indicatorLabels, LanguageProvider, LanguageToggle, useLanguage } from './i18n'
import type { UiText } from './i18n'
import './styles.css'

const SeriesChart = lazy(() => import('./SeriesChart'))
const defaults: Filters = { datasetId: '', code: 'gdp', start: '2024-Q1', end: '2025-Q1' }
const periodPattern = '(?!0000)[0-9]{4}-Q[1-4]'

type QueryResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: UiText }
  | { status: 'ready'; series: IndicatorSeries }

function percent(value: string | null) {
  return value === null ? '—' : `${Number(value) > 0 ? '+' : ''}${value}%`
}

function Results({ series }: { series: IndicatorSeries }) {
  const { t } = useLanguage()
  const name = t(...indicatorLabels[series.code])
  const unit = displayUnit(series.unit, t)
  const trendTitle = t(`${name}趋势`, `${name} trend`)
  const latest = series.points.at(-1)
  if (!latest) {
    return <section className="panel notice" role="status">{t("这个季度范围内没有观测值。请调整筛选条件。", "No observations in this range. Adjust the quarter filters.")}</section>
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3" aria-label={t(`${latest.period} 指标摘要`, `${latest.period} indicator summary`)}>
        {[
          { label: t("最新观测值", "Latest value"), value: latest.value, unit },
          { label: t("同比", "Year over year"), value: percent(latest.yoy_percent), unit: '' },
          { label: t("环比", "Quarter over quarter"), value: percent(latest.qoq_percent), unit: '' },
        ].map(({ label, value, unit }) => (
          <div key={label} className="panel metric">
            <div className="flex items-center justify-between gap-2 text-sm text-stone-600">
              <span>{label}</span><span className="tabular-nums">{latest.period}</span>
            </div>
            <div className="mt-3 break-all text-2xl font-semibold tabular-nums sm:text-3xl">
              {value} <span className="text-sm font-normal text-stone-600">{unit}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="panel overflow-hidden" aria-labelledby="trend-title">
        <div className="section-heading">
          <div>
            <h2 id="trend-title">{trendTitle}</h2>
            <p>{t("季度数据", "Quarterly data")} · {unit}</p>
          </div>
          <span className="series-key">{series.code.toUpperCase()}</span>
        </div>
        <Suspense fallback={<p className="notice" role="status">{t("正在加载趋势图…", "Loading trend chart…")}</p>}>
          <SeriesChart points={series.points} unit={unit} name={name} label={trendTitle} />
        </Suspense>
        <p className="border-t border-stone-100 px-5 py-3 text-sm text-stone-600">{t("数据来源", "Source")} · {series.source}</p>
      </section>

      <section className="panel overflow-hidden" aria-labelledby="table-title">
        <div className="section-heading">
          <h2 id="table-title">{t("季度明细", "Quarterly observations")}</h2>
          <span className="text-sm text-stone-600">{t(`${series.points.length} 条观测值`, `${series.points.length} observations`)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="bg-[#eef3ee] text-stone-700">
              <tr>{[t("季度", "Quarter"), t(`观测值（${unit}）`, `Value (${unit})`), t("同比", "Year over year"), t("环比", "Quarter over quarter")].map((label) => <th key={label} scope="col">{label}</th>)}</tr>
            </thead>
            <tbody>
              {series.points.map((point) => (
                <tr key={point.period}>
                  <th scope="row">{point.period}</th>
                  <td>{point.value}</td>
                  <td>{percent(point.yoy_percent)}</td>
                  <td>{percent(point.qoq_percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-xs text-stone-600">{t("— 表示缺少基期数据或基期为零", "— means the comparison period is missing or its value is zero.")}</p>
      </section>
    </div>
  )
}

function Dashboard({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(defaults)
  const [filters, setFilters] = useState<Filters | null>(null)
  const [validation, setValidation] = useState(false)
  const [result, setResult] = useState<QueryResult>({ status: 'idle' })
  const [leaving, setLeaving] = useState(false)
  const [logoutError, setLogoutError] = useState<UiText | null>(null)

  useEffect(() => {
    if (!filters) return
    const controller = new AbortController()
    fetchSeries(filters, controller.signal).then(
      (series) => { if (!controller.signal.aborted) setResult({ status: 'ready', series }) },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            status: 'error',
            message: errorMessage(error),
          })
        }
      },
    )
    return () => controller.abort()
  }, [filters])

  function explore(record: DatasetRecord) {
    if (!record.first_period || !record.last_period || record.codes.length === 0) return
    const next: Filters = {
      datasetId: String(record.id),
      code: record.codes.includes(draft.code) ? draft.code : record.codes[0],
      start: record.first_period,
      end: record.last_period,
    }
    setValidation(false)
    setDraft(next)
    setResult({ status: 'loading' })
    setFilters(next)
  }

  async function signOut() {
    setLeaving(true)
    setLogoutError(null)
    try {
      await logout()
      onLogout()
    } catch (failure) {
      setLogoutError(errorMessage(failure))
    } finally {
      setLeaving(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.start > draft.end) {
      setValidation(true)
      return
    }
    setValidation(false)
    setResult({ status: 'loading' })
    setFilters({ ...draft })
  }

  return (
    <>
      <header className="app-header">
        <div className="workspace-width app-toolbar">
          <div className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span className="text-lg">EconoMind</span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden truncate text-sm text-stone-600 sm:block">{account.email}</span>
            <LanguageToggle />
            <button type="button" className="secondary-button" onClick={signOut} disabled={leaving}>{t("退出登录", "Sign out")}</button>
          </div>
        </div>
      </header>
      <main className="workspace-width py-7 sm:py-10">
        <div className="workspace-heading">
          <h1 className="workspace-title">{t("季度指标仪表盘", "Quarterly Indicators")}</h1>
        </div>
        {logoutError && <p className="mb-3 text-sm text-red-800" role="alert">{t(...logoutError)}</p>}
        <div className="workspace-tools">
          <DatasetWorkspace onExplore={explore} />
          <form className="panel query-form p-5" onSubmit={submit} aria-labelledby="query-title">
            <h2 id="query-title" className="mb-4 text-lg font-semibold">{t("指标查询", "Indicator search")}</h2>
            <div className="query-fields">
              <label>{t("数据集编号", "Dataset ID")}
                <input required type="number" min="1" max="2147483647" step="1" value={draft.datasetId}
                  onChange={(event) => setDraft({ ...draft, datasetId: event.target.value })} />
              </label>
              <div>
                <label htmlFor="indicator-code">{t("指标", "Indicator")}</label>
                <select id="indicator-code" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value as IndicatorCode })}>
                  <option value="gdp">GDP · {t(...indicatorLabels.gdp)}</option>
                  <option value="cpi">CPI · {t(...indicatorLabels.cpi)}</option>
                </select>
              </div>
              <label>{t("起始季度", "Start quarter")}
                <input required spellCheck={false} pattern={periodPattern} title={t("格式示例：2024-Q1", "Example: 2024-Q1")}
                  value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
              </label>
              <label>{t("结束季度", "End quarter")}
                <input required spellCheck={false} pattern={periodPattern} title={t("格式示例：2025-Q1", "Example: 2025-Q1")}
                  value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
              </label>
              <button type="submit">{t("查询指标", "Search indicators")}</button>
            </div>
            {validation && <p className="mt-3 text-sm text-red-800" role="alert">{t("起始季度须早于或等于结束季度。", "The start quarter must be on or before the end quarter.")}</p>}
          </form>
        </div>
        {result.status === 'idle' && <p className="notice query-hint" role="status">{t("选择导入记录，或输入数据集编号查询指标。", "Choose an import or enter a dataset ID to view indicators.")}</p>}
        {result.status === 'loading' && <p className="panel notice" role="status">{t("正在读取指标…", "Loading indicators…")}</p>}
        {result.status === 'error' && <p className="panel notice text-red-800" role="alert">{t(...result.message)}</p>}
        {result.status === 'ready' && <Results series={result.series} />}
        {result.status === 'ready' && filters && (
          <ForecastPanel key={'forecast-' + JSON.stringify(filters)} filters={filters} />
        )}
        {result.status === 'ready' && filters && (
          <ResearchPanel key={JSON.stringify(filters)} filters={filters} />
        )}
      </main>
    </>
  )
}

function App() {
  const { t } = useLanguage()
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<UiText | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    currentAccount(controller.signal).then(
      (user) => { if (!controller.signal.aborted) setAccount(user) },
      (failure: unknown) => { if (!controller.signal.aborted) setError(errorMessage(failure)) },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  if (loading) return <main className="mx-auto max-w-md px-5 py-16" role="status">{t("正在检查登录状态…", "Checking your session…")}</main>
  if (!account) return <AccountForm initialError={error} onLogin={setAccount} />
  return <Dashboard account={account} onLogout={() => { setError(null); setAccount(null) }} />
}

createRoot(document.getElementById('root')!).render(<StrictMode><LanguageProvider><App /></LanguageProvider></StrictMode>)
