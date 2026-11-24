import { lazy, Suspense, useEffect, useState } from 'react'
import { checkCatalog, errorMessage, getCatalogVersion, importCatalogVersion, listCatalogVersions, uploadDataset } from './api'
import type { CatalogSnapshot, CatalogVersion, Filters, IndicatorCode } from './api'
import { catalog, categories, matches } from './catalog'
import type { CatalogEntry, Category } from './catalog'
import { displayUnit, indicatorLabels, useLanguage } from './i18n'
import { RetailTable } from './RetailAnalysis'
import { isPriceCode } from './prices'
import { retailBasis } from './retail'
import type { UiText } from './i18n'

const SeriesChart = lazy(() => import('./SeriesChart'))

interface ImportProps {
  busy: boolean
  setBusy: (busy: boolean) => void
  onImported: (filters: Filters, source: string, codes: IndicatorCode[]) => void
}

function Preview({ entry, busy, setBusy, onImported, versionId }: ImportProps & { entry: CatalogEntry; versionId?: number }) {
  const { t } = useLanguage()
  const quarters = [...new Set(entry.rows.map(row => row.period))].sort()
  const codes = [...new Set(entry.rows.map(row => row.code))]
  const [start, setStart] = useState(quarters[0])
  const [end, setEnd] = useState(quarters.at(-1)!)
  const [code, setCode] = useState<IndicatorCode>(codes[0])
  const [error, setError] = useState<UiText | null>(null)
  const rows = entry.rows.filter(row => row.period >= start && row.period <= end)
  const csv = ['code,period,value', ...rows.map(r => [r.code, r.period, r.value].join(',')), ''].join('\r\n')
  const filename = `${entry.id}_${start}_${end}.csv`
  const points = rows.filter(row => row.code === code)
  const monthly = isPriceCode(code)
  const unit = (indicator: IndicatorCode) => displayUnit(indicator === 'cpi' || indicator.endsWith('_index') ? '指数点' : isPriceCode(indicator) || indicator.startsWith('online_share_') ? '%' : '亿元', t)

  async function importSelection() {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('source', entry.source)
      form.append('file', new File([csv], filename, { type: 'text/csv;charset=utf-8' }))
      const { dataset_id } = versionId
        ? await importCatalogVersion(entry.id, versionId, start, end)
        : await uploadDataset(form)
      onImported({ datasetId: String(dataset_id), code, start, end }, entry.source, codes)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="preview-title">
    <p className="text-sm font-medium text-[#37694f]">{t(...entry.kind)} · {t(...entry.publisher)}</p>
    <h2 id="preview-title" className="mt-2 text-2xl font-semibold">{t(...entry.title)}</h2>
    <p className="mt-3 text-sm leading-relaxed text-stone-700">{t(...entry.method)}</p>
    {entry.id === 'china-info-services' && <p className="mt-2 text-sm text-stone-600">{t(
      '信息传输、软件和信息技术服务业属于第三产业，第三产业金额已包含该行业。',
      'The tertiary industry total already includes information transmission, software and IT services.')}</p>}
    {entry.releases && <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-semibold">{monthly ? t('逐月原表与发布日期', 'Monthly sources and release dates') : t('逐季来源与发布日期', 'Quarterly sources and release dates')}</summary>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{entry.releases.filter(r => r.period >= start && r.period <= end).map(({period, date, url}) =>
        <li key={period}><a className="underline" href={url} target="_blank" rel="noreferrer">{period} · {date}</a>{versionId && <a className="ml-2 underline" target="_blank" rel="noreferrer"
          href={`/api/v1/catalog/${entry.id}/versions/${versionId}/sources/${period}`}>{t('留档', 'Archive')}</a>}</li>)}</ul>
    </details>}
    <fieldset disabled={busy} className="mt-5 grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-3">
      <label>{monthly ? t('起始月份', 'Start month') : t('起始季度', 'Start quarter')}<select value={start} onChange={e => {
        setStart(e.target.value)
        if (e.target.value > end) setEnd(e.target.value)
      }}>{quarters.map(q => <option key={q}>{q}</option>)}</select></label>
      <label>{monthly ? t('结束月份', 'End month') : t('结束季度', 'End quarter')}<select value={end} onChange={e => setEnd(e.target.value)}>
        {quarters.filter(q => q >= start).map(q => <option key={q}>{q}</option>)}
      </select></label>
      {codes.length > 1 && <label>{t('图表指标', 'Chart indicator')}<select value={code} onChange={e => setCode(e.target.value as IndicatorCode)}>
        {codes.map(c => <option key={c} value={c}>{t(...indicatorLabels[c])}</option>)}
      </select></label>}
    </fieldset>
    <div className="my-5 flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} onClick={importSelection}>{busy ? t('正在导入…', 'Importing…') : t('导入并分析', 'Import and analyze')}</button>
      <a className="secondary-button rounded-lg px-4 py-3 text-sm font-semibold" download={filename}
        href={'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)}>{t('下载 CSV', 'Download CSV')}</a>
    </div>
    {retailBasis(code) && <p className="mb-3 text-sm text-stone-600">{t('下载和导入包含所选季度的累计与当季两组数据。', 'Downloads and imports include both YTD and quarter-only data for the selected quarters.')}</p>}
    <h3 className="font-semibold">{t('数据预览', 'Data preview')} · {t(...indicatorLabels[code])} ({unit(code)})</h3>
    {error && <p role="alert" className="mt-2 text-red-800">{t(...error)}</p>}
    {points.length > 0 && <Suspense fallback={<p role="status">{t('正在加载趋势图…', 'Loading chart…')}</p>}>
      <SeriesChart points={points} unit={unit(code)} name={t(...indicatorLabels[code])} />
    </Suspense>}
    {retailBasis(code) ? <RetailTable code={code} rows={rows} official releases={entry.releases} /> : <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums" aria-label={t('预览明细', 'Preview observations')}>
      <thead className="bg-[#eef3ee]"><tr>{[monthly ? t('月份','Month') : t('季度','Quarter'), t('指标','Indicator'), t('数值','Value'), t('单位','Unit')].map(label =>
        <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.period + r.code}><th scope="row">{r.period}</th><td>{t(...indicatorLabels[r.code])}</td><td>{r.value}</td><td>{unit(r.code)}</td></tr>)}</tbody>
    </table></div>}
  </section>
}

function VersionedPreview({ entry, ...props }: ImportProps & { entry: CatalogEntry }) {
  const { t } = useLanguage()
  const [versions, setVersions] = useState<CatalogVersion[]>([])
  const [selected, setSelected] = useState<number>()
  const [snapshot, setSnapshot] = useState<{ id: number; data: CatalogSnapshot }>()
  const [notice, setNotice] = useState<UiText>()
  const [error, setError] = useState<UiText>()
  const [pending, setPending] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    listCatalogVersions(entry.id, controller.signal)
      .then(list => { setVersions(list); setSelected(list[0]?.id) })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)) })
      .finally(() => { if (!controller.signal.aborted) setPending(false) })
    return () => controller.abort()
  }, [entry.id])

  useEffect(() => {
    if (selected === undefined) return
    const controller = new AbortController()
    getCatalogVersion(entry.id, selected, controller.signal)
      .then(data => { if (!controller.signal.aborted) setSnapshot({ id: selected, data }) })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)) })
    return () => controller.abort()
  }, [entry.id, selected])

  async function check() {
    setError(undefined)
    setNotice(undefined)
    setPending(true)
    try {
      const result = await checkCatalog(entry.id)
      const list = await listCatalogVersions(entry.id)
      setVersions(list)
      setSelected(result.id)
      setNotice(result.changed
        ? [`已保存新版本 #${result.id}，截至 ${result.end}。`, `Saved version #${result.id}, through ${result.end}.`]
        : [`已检查，截至 ${result.end}，无变更。`, `Checked through ${result.end}. No changes.`])
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  const current = snapshot?.id === selected ? snapshot : undefined
  return <div className="min-w-0 space-y-4">
    <section className="panel flex flex-wrap items-end gap-3 p-4">
      <label>{t('版本历史', 'Version history')}
        <select aria-label={t('版本历史', 'Version history')} value={selected ?? ''} disabled={pending || props.busy || !versions.length}
          onChange={e => { setError(undefined); setSelected(Number(e.target.value)) }}>
          {versions.map(v => <option key={v.id} value={v.id}>#{v.id} · {v.end} · {v.created_at.slice(0, 10)}</option>)}
        </select>
      </label>
      <button type="button" onClick={check} disabled={pending || props.busy}>
        {pending ? t('正在检查…', 'Checking…') : t('立即检查', 'Check now')}
      </button>
      {notice && <p className="w-full text-sm" role="status">{t(...notice)}</p>}
      {error && <p className="w-full text-sm text-red-800" role="alert">{t(...error)}</p>}
    </section>
    {current ? <Preview key={current.id} entry={{ ...entry, ...current.data }} versionId={current.id} {...props} />
      : <Preview entry={entry} {...props} busy={true} />}
  </div>
}

export function DataCenter(props: ImportProps) {
  const { t } = useLanguage()
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(catalog[0].id)
  const results = catalog.filter(entry => (category === 'all' || entry.category === category) && matches(entry, query))
  const active = results.find(item => item.id === selected) ?? results[0]

  return <div className="grid items-start gap-5 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)]">
    <aside className="panel min-w-0 p-5">
      <label>{t('搜索数据集', 'Search datasets')}
        <input type="search" disabled={props.busy} value={query} onChange={e => setQuery(e.target.value)}
          placeholder={t('中国 GDP、预测、CPI…', 'China GDP, forecast, CPI…')} />
      </label>
      <label className="mt-3">{t('分类', 'Category')}
        <select aria-label={t('分类', 'Category')} value={category} disabled={props.busy} onChange={e => setCategory(e.target.value as Category | 'all')}>
          <option value="all">{t('全部分类', 'All categories')}</option>
          {(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{t(...categories[key])}</option>)}
        </select>
      </label>
      <p className="my-4 text-sm text-stone-600" role="status">{t(`${results.length} 套数据`, `${results.length} dataset${results.length === 1 ? '' : 's'}`)}</p>
      <div className="grid gap-2">{results.map(item =>
        <button key={item.id} type="button" disabled={props.busy} className="catalog-choice" aria-pressed={active?.id === item.id}
          onClick={() => setSelected(item.id)}>
          <span className="block font-semibold">{t(...item.title)}</span>
          <span className="mt-1 block text-xs font-normal">{t(...item.kind)} · {item.rows[0].period} – {item.rows.at(-1)!.period}</span>
        </button>)}</div>
    </aside>
    {active ? active.releases ? <VersionedPreview key={active.id} entry={active} {...props} />
      : <Preview key={active.id} entry={active} {...props} /> :
      <p className="panel notice">{t('未找到数据集。试试 GDP、CPI 或预测。', 'No matching datasets. Try GDP, CPI or forecast.')}</p>}
  </div>
}
