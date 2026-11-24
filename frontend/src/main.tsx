import { StrictMode, Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { currentAccount, errorMessage, fetchSeries, logout } from './api'
import type { Account, DatasetRecord, Filters, IndicatorCode, IndicatorSeries } from './api'
import { AccountForm } from './AccountForm'
import { DataCenter } from './DataCenter'
import { ComparisonPanel } from './ComparisonPanel'
import { RetailAnalysis } from './RetailAnalysis'
import { retailBasis } from './retail'
import { catalog, accountsReleases } from './catalog'
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

function observationValue(value: string) {
  return value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

function percent(value: string | null) {
  return value === null ? '—' : `${Number(value) > 0 ? '+' : ''}${value}%`
}

function Results({ series }: { series: IndicatorSeries }) {
  const { t } = useLanguage()
  const name = t(...indicatorLabels[series.code])
  const unit = displayUnit(series.unit, t)
  const releases = accountsReleases(series.source)
  const nominal = !!releases
  const yoy = nominal ? t("名义同比", "Nominal year over year") : t("同比", "Year over year")
  const qoq = nominal ? t("名义环比（未季调）", "Nominal quarter over quarter (unadjusted)") : t("环比", "Quarter over quarter")
  const trendTitle = t(`${name}趋势`, `${name} trend`)
  const latest = series.points.at(-1)
  if (!latest) {
    return <section className="panel notice" role="status">{t("这个季度范围内没有观测值。请调整筛选条件。", "No observations in this range. Adjust the quarter filters.")}</section>
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3" aria-label={t(`${latest.period} 指标摘要`, `${latest.period} indicator summary`)}>
        {[
          { label: t("最新观测值", "Latest value"), value: observationValue(latest.value), unit },
          { label: yoy, value: percent(latest.yoy_percent), unit: '' },
          { label: qoq, value: percent(latest.qoq_percent), unit: '' },
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
          <span className="series-key">{t("季度", "Quarterly")}</span>
        </div>
        <Suspense fallback={<p className="notice" role="status">{t("正在加载趋势图…", "Loading trend chart…")}</p>}>
          <SeriesChart points={series.points} unit={unit} name={name} label={trendTitle} />
        </Suspense>
        <p className="border-t border-stone-100 px-5 py-3 text-sm text-stone-600">{t("数据来源", "Source")} · {nominal ? t(series.source, 'National Bureau of Statistics of China · Each quarter’s preliminary release, Table 1. Current-price amounts, unadjusted nominal growth.') : series.source}</p>
      </section>

      <section className="panel overflow-hidden" aria-labelledby="table-title">
        <div className="section-heading">
          <h2 id="table-title">{t("季度明细", "Quarterly observations")}</h2>
          <span className="text-sm text-stone-600">{t(`${series.points.length} 条观测值`, `${series.points.length} observations`)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="bg-[#eef3ee] text-stone-700">
              <tr>{[t("季度", "Quarter"), t(`观测值（${unit}）`, `Value (${unit})`), yoy, qoq].map((label) => <th key={label} scope="col">{label}</th>)}</tr>
            </thead>
            <tbody>
              {series.points.map((point) => {
                const original = nominal && releases.find(r => r.period === point.period)
                return (
                <tr key={point.period}>
                  <th scope="row">{nominal && original ? <a className="underline text-[#175943]" href={original.url} target="_blank" rel="noreferrer"
                    aria-label={t(`${point.period} 官方原表，发布于 ${original.date}`, `${point.period} official table, released ${original.date}`)}>{point.period} ↗</a> : point.period}</th>
                  <td>{observationValue(point.value)}</td>
                  <td>{percent(point.yoy_percent)}</td>
                  <td>{percent(point.qoq_percent)}</td>
                </tr>
                )
              })}
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
  const [page, setPage] = useState<'workspace' | 'data'>('data')
  const [dataView, setDataView] = useState<'catalog' | 'library'>('catalog')
  const [selection, setSelection] = useState<{ source: string; codes: IndicatorCode[] } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const title = catalog.find(entry => entry.source === selection?.source)?.title
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [page])
  const [importing, setImporting] = useState(false)
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
    analyze(next, record.source, record.codes)
  }

  function chooseDataset() {
    setDataView('library')
    setPage('data')
  }

  function analyze(next: Filters, source: string, codes: IndicatorCode[]) {
    setSelection({ source, codes })
    setPage('workspace')
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
            <button type="button" className="secondary-button" onClick={signOut} disabled={leaving || importing}>{t("退出登录", "Sign out")}</button>
          </div>
        </div>
      </header>
      <main className="workspace-width py-7 sm:py-10">
        <nav aria-label={t('工作区导航', 'Workspace navigation')} className="workspace-nav">
          <button type="button" aria-current={page === 'data' ? 'page' : undefined} disabled={importing}
            onClick={() => setPage('data')}>{t('数据中心', 'Data center')}</button>
          <button type="button" aria-current={page === 'workspace' ? 'page' : undefined} disabled={importing}
            onClick={() => setPage('workspace')}>{t('分析工作台', 'Analysis workspace')}</button>
        </nav>
        <div className="workspace-heading">
          <h1 className="workspace-title" ref={heading} tabIndex={-1}>{page === 'data' ? t('数据中心', 'Data center') : t('分析工作台', 'Analysis workspace')}</h1>
        </div>
        {logoutError && <p className="mb-3 text-sm text-red-800" role="alert">{t(...logoutError)}</p>}
        {page === 'data' && <>
          <div className="data-views" role="group" aria-label={t('数据来源', 'Dataset source')}>
            <button type="button" aria-pressed={dataView === 'catalog'} disabled={importing}
              onClick={() => setDataView('catalog')}>{t('内置数据集', 'Built-in datasets')}</button>
            <button type="button" aria-pressed={dataView === 'library'} disabled={importing}
              onClick={() => setDataView('library')}>{t('CSV 导入与记录', 'CSV imports and history')}</button>
          </div>
          {dataView === 'catalog' ? <DataCenter busy={importing} setBusy={setImporting} onImported={analyze} /> :
            <DatasetWorkspace onExplore={explore} uploading={importing} setUploading={setImporting} />}
        </>}
        <div hidden={page !== 'workspace'}>
          {selection && filters ? <>
            <section className="analysis-context">
              <div className="min-w-0">
                <p className="text-sm">{t('当前数据集', 'Current dataset')} · #{filters.datasetId}</p>
                <h2 className="mt-1 break-words text-xl font-semibold">{title ? t(...title) : selection.source}</h2>
                <p className="mt-2 text-sm">{t(...indicatorLabels[filters.code])} · {filters.start} – {filters.end}</p>
              </div>
              <button type="button" className="secondary-button" onClick={chooseDataset}>{t('更换数据集', 'Change dataset')}</button>
            </section>
            <form className="panel query-form mb-5 p-5" onSubmit={submit} aria-labelledby="query-title">
              <h2 id="query-title" className="mb-4 text-lg font-semibold">{t("分析范围", "Analysis filters")}</h2>
              <div className="query-fields">
                <div>
                  <label htmlFor="indicator-code">{t("指标", "Indicator")}</label>
                  <select id="indicator-code" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value as IndicatorCode })}>
                    {selection.codes.map(code => <option key={code} value={code}>{t(...indicatorLabels[code])}</option>)}
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
          </> : <section className="panel analysis-empty">
            <h2 className="text-xl font-semibold">{t('选择要分析的数据集', 'Choose a dataset to analyze')}</h2>
            <p className="my-3 text-sm text-stone-600">{t('可以打开导入记录中的数据集，也可以从内置目录导入样例。', 'Open a dataset from your import history or choose a sample from the catalog.')}</p>
            <button type="button" onClick={chooseDataset}>{t('选择数据集', 'Choose dataset')}</button>
          </section>}
          {result.status === 'loading' && <p className="panel notice" role="status">{t("正在读取指标…", "Loading indicators…")}</p>}
          {result.status === 'error' && <p className="panel notice text-red-800" role="alert">{t(...result.message)}</p>}
          {result.status === 'ready' && filters && selection && !retailBasis(filters.code) && filters.code !== 'cpi' && selection.codes.some(c => c !== filters.code && c !== 'cpi' && !retailBasis(c)) &&
            <ComparisonPanel key={'comparison-' + JSON.stringify(filters)} filters={filters} primary={result.series} codes={selection.codes} />}
          {result.status === 'ready' && filters && (retailBasis(filters.code)
            ? <RetailAnalysis key={'retail-' + JSON.stringify(filters)} filters={filters} primary={result.series} />
            : <Results series={result.series} />)}
          {result.status === 'ready' && filters && retailBasis(filters.code) !== 'ytd' && !filters.code.startsWith('online_share_') && (
            <ForecastPanel key={'forecast-' + JSON.stringify(filters)} filters={filters} />
          )}
          {result.status === 'ready' && filters && (
            <ResearchPanel key={JSON.stringify(filters)} filters={filters} canCompare={!!selection?.codes.includes('gdp') && selection.codes.includes('cpi') && ['gdp','cpi'].includes(filters.code)} />
          )}
        </div>
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
