import { lazy, Suspense, useState } from 'react'
import { errorMessage, uploadDataset } from './api'
import type { Filters, IndicatorCode } from './api'
import { catalog, categories, matches } from './catalog'
import type { CatalogEntry, Category } from './catalog'
import { displayUnit, indicatorLabels, useLanguage } from './i18n'
import { RetailTable } from './RetailAnalysis'
import { retailBasis } from './retail'
import type { UiText } from './i18n'

const SeriesChart = lazy(() => import('./SeriesChart'))

interface ImportProps {
  busy: boolean
  setBusy: (busy: boolean) => void
  onImported: (filters: Filters, source: string, codes: IndicatorCode[]) => void
}

function Preview({ entry, busy, setBusy, onImported }: ImportProps & { entry: CatalogEntry }) {
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
  const unit = (indicator: IndicatorCode) => displayUnit(indicator === 'cpi' ? '指数点' : indicator.startsWith('online_share_') ? '%' : '亿元', t)

  async function importSelection() {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('source', entry.source)
      form.append('file', new File([csv], filename, { type: 'text/csv;charset=utf-8' }))
      const { dataset_id } = await uploadDataset(form)
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
      <summary className="cursor-pointer font-semibold">{t('逐季来源与发布日期', 'Quarterly sources and release dates')}</summary>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{entry.releases.filter(r => r.period >= start && r.period <= end).map(({period, date, url}) =>
        <li key={period}><a className="underline" href={url} target="_blank" rel="noreferrer">{period} · {date}</a></li>)}</ul>
    </details>}
    <fieldset disabled={busy} className="mt-5 grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-3">
      <label>{t('起始季度', 'Start quarter')}<select value={start} onChange={e => {
        setStart(e.target.value)
        if (e.target.value > end) setEnd(e.target.value)
      }}>{quarters.map(q => <option key={q}>{q}</option>)}</select></label>
      <label>{t('结束季度', 'End quarter')}<select value={end} onChange={e => setEnd(e.target.value)}>
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
    {retailBasis(code) ? <RetailTable code={code} rows={rows} official /> : <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums" aria-label={t('预览明细', 'Preview observations')}>
      <thead className="bg-[#eef3ee]"><tr>{[t('季度','Quarter'), t('指标','Indicator'), t('数值','Value'), t('单位','Unit')].map(label =>
        <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.period + r.code}><th scope="row">{r.period}</th><td>{t(...indicatorLabels[r.code])}</td><td>{r.value}</td><td>{unit(r.code)}</td></tr>)}</tbody>
    </table></div>}
  </section>
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
    {active ? <Preview key={active.id} entry={active} {...props} /> :
      <p className="panel notice">{t('未找到数据集。试试 GDP、CPI 或预测。', 'No matching datasets. Try GDP, CPI or forecast.')}</p>}
  </div>
}
