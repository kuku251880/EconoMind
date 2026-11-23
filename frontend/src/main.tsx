import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { currentAccount, errorMessage, fetchSeries, indicators, logout } from './api'
import type { Account, DatasetRecord, Filters, IndicatorCode, IndicatorSeries } from './api'
import { AccountForm } from './AccountForm'
import { DatasetWorkspace } from './DatasetWorkspace'
import { ForecastPanel } from './ForecastPanel'
import { ResearchPanel } from './ResearchPanel'
import './styles.css'

const SeriesChart = lazy(() => import('./SeriesChart'))
const defaults: Filters = { datasetId: '', code: 'gdp', start: '2024-Q1', end: '2025-Q1' }
const periodPattern = '(?!0000)[0-9]{4}-Q[1-4]'

type QueryResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; series: IndicatorSeries }

function percent(value: string | null) {
  return value === null ? '—' : `${Number(value) > 0 ? '+' : ''}${value}%`
}

function Results({ series }: { series: IndicatorSeries }) {
  const name = indicators[series.code]
  const latest = series.points.at(-1)
  if (!latest) {
    return <section className="panel notice" role="status">这个季度范围内没有观测值。请调整筛选条件。</section>
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3" aria-label={`${latest.period} 指标摘要`}>
        {[
          { label: '最新观测值', value: latest.value, unit: series.unit },
          { label: '同比', value: percent(latest.yoy_percent), unit: '' },
          { label: '环比', value: percent(latest.qoq_percent), unit: '' },
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
            <h2 id="trend-title">{name}趋势</h2>
            <p>季度数据 · {series.unit}</p>
          </div>
          <span className="series-key">{series.code.toUpperCase()}</span>
        </div>
        <Suspense fallback={<p className="notice" role="status">正在加载趋势图…</p>}>
          <SeriesChart points={series.points} unit={series.unit} name={name} />
        </Suspense>
        <p className="border-t border-stone-100 px-5 py-3 text-sm text-stone-600">数据来源 · {series.source}</p>
      </section>

      <section className="panel overflow-hidden" aria-labelledby="table-title">
        <div className="section-heading">
          <h2 id="table-title">季度明细</h2>
          <span className="text-sm text-stone-600">{series.points.length} 条观测值</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="bg-[#eef3ee] text-stone-700">
              <tr>{['季度', `观测值（${series.unit}）`, '同比', '环比'].map((label) => <th key={label} scope="col">{label}</th>)}</tr>
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
        <p className="px-5 py-3 text-xs text-stone-600">— 表示缺少基期数据或基期为零</p>
      </section>
    </div>
  )
}

function Dashboard({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [draft, setDraft] = useState(defaults)
  const [filters, setFilters] = useState<Filters | null>(null)
  const [validation, setValidation] = useState('')
  const [result, setResult] = useState<QueryResult>({ status: 'idle' })
  const [leaving, setLeaving] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  useEffect(() => {
    if (!filters) return
    const controller = new AbortController()
    fetchSeries(filters, controller.signal).then(
      (series) => { if (!controller.signal.aborted) setResult({ status: 'ready', series }) },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            status: 'error',
            message: error instanceof TypeError ? '无法连接数据服务。请检查本地服务是否已启动。'
              : error instanceof Error ? error.message : '查询失败，请重试。',
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
    setValidation('')
    setDraft(next)
    setResult({ status: 'loading' })
    setFilters(next)
  }

  async function signOut() {
    setLeaving(true)
    setLogoutError('')
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
      setValidation('起始季度须早于或等于结束季度。')
      return
    }
    setValidation('')
    setResult({ status: 'loading' })
    setFilters({ ...draft })
  }

  return (
    <>
      <header className="border-b border-[#dce6df] bg-[#fcfdfa]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span className="text-lg">EconoMind</span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden truncate text-sm text-stone-600 sm:block">{account.email}</span>
            <button type="button" className="secondary-button" onClick={signOut} disabled={leaving}>退出登录</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">季度指标仪表盘</h1>
        </div>
        {logoutError && <p className="mb-3 text-sm text-red-800" role="alert">{logoutError}</p>}
        <DatasetWorkspace onExplore={explore} />
        <form className="panel mb-5 p-5" onSubmit={submit} aria-label="指标查询">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1.25fr_1fr_1fr_auto]">
            <label>数据集编号
              <input required type="number" min="1" max="2147483647" step="1" value={draft.datasetId}
                onChange={(event) => setDraft({ ...draft, datasetId: event.target.value })} />
            </label>
            <div>
              <label htmlFor="indicator-code">指标</label>
              <select id="indicator-code" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value as IndicatorCode })}>
                <option value="gdp">GDP · 国内生产总值</option>
                <option value="cpi">CPI · 居民消费价格指数</option>
              </select>
            </div>
            <label>起始季度
              <input required spellCheck={false} pattern={periodPattern} title="格式示例：2024-Q1"
                value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
            </label>
            <label>结束季度
              <input required spellCheck={false} pattern={periodPattern} title="格式示例：2025-Q1"
                value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
            </label>
            <button type="submit">查询指标</button>
          </div>
          {validation && <p className="mt-3 text-sm text-red-800" role="alert">{validation}</p>}
        </form>
        {result.status === 'idle' && <p className="panel notice" role="status">选择导入记录，或输入数据集编号查询指标。</p>}
        {result.status === 'loading' && <p className="panel notice" role="status">正在读取指标…</p>}
        {result.status === 'error' && <p className="panel notice text-red-800" role="alert">{result.message}</p>}
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
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    currentAccount(controller.signal).then(
      (user) => { if (!controller.signal.aborted) setAccount(user) },
      (failure: unknown) => { if (!controller.signal.aborted) setError(errorMessage(failure)) },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  if (loading) return <main className="mx-auto max-w-md px-5 py-16" role="status">正在检查登录状态…</main>
  if (!account) return <AccountForm initialError={error} onLogin={setAccount} />
  return <Dashboard account={account} onLogout={() => { setError(''); setAccount(null) }} />
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
