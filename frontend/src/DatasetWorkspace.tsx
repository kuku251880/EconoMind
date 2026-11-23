import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage, listDatasets, uploadDataset } from './api'
import type { DatasetRecord } from './api'
import { useLanguage } from './i18n'
import type { UiText } from './i18n'

export function DatasetWorkspace({ onExplore }: {
  onExplore: (record: DatasetRecord) => void
}) {
  const { t } = useLanguage()
  const [records, setRecords] = useState<DatasetRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<UiText | null>(null)
  const [notice, setNotice] = useState<number | null>(null)
  const [filename, setFilename] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    listDatasets(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setRecords(data) },
      (failure: unknown) => { if (!controller.signal.aborted) setError(errorMessage(failure)) },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setUploading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await uploadDataset(new FormData(form))
      form.reset()
      setFilename('')
      setNotice(result.dataset_id)
      try {
        const updated = await listDatasets()
        setRecords(updated)
        const imported = updated.find((record) => record.id === result.dataset_id)
        if (imported) onExplore(imported)
      } catch {
        setError(['文件已导入。请刷新页面以更新导入记录。', 'The file was imported. Refresh to update import history.'])
      }
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="panel min-w-0 overflow-hidden" aria-labelledby="imports-title">
      <div className="section-heading"><h2 id="imports-title">{t("导入记录", "Import history")}</h2></div>
      <form className="import-fields" onSubmit={upload}>
        <label>{t("数据来源", "Data source")}
          <input name="source" required maxLength={200} placeholder={t("例如：课程样例", "Example: Course sample")} />
        </label>
        <label className="min-w-0">
          {t('CSV 文件', 'CSV file')}
          <input type="file" name="file" accept=".csv,text/csv" required className="peer sr-only"
            aria-label={t('CSV 文件', 'CSV file')}
            onChange={(event) => setFilename(event.target.files?.[0]?.name ?? '')} />
          <span className="mt-1.5 flex h-11 cursor-pointer items-center gap-3 rounded-lg border border-[#cdd9d0] bg-white px-3 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#08715d]">
            <span className="shrink-0 font-semibold">{t('选择文件', 'Choose file')}</span>
            <span className="truncate font-normal text-stone-600">{filename || t('未选择文件', 'No file selected')}</span>
          </span>
        </label>
        <button type="submit" disabled={loading || uploading}>{uploading ? t("正在导入…", "Importing…") : t("导入 CSV", "Import CSV")}</button>
        <p className="text-xs text-stone-600 import-help">{t("UTF-8 · 最多 2 MiB · 列名 code, period, value", "UTF-8 · Up to 2 MiB · Columns: code, period, value")}</p>
      </form>
      {error && <p role="alert" className="px-5 pb-3 text-sm text-red-800">{t(...error)}</p>}
      {notice && <p role="status" className="px-5 pb-3 text-sm text-[#075947]">{t(`已导入数据集 #${notice}。`, `Imported dataset #${notice}.`)}</p>}
      {loading && <p role="status" className="border-t border-stone-100 px-5 py-4 text-sm">{t("正在读取导入记录…", "Loading import history…")}</p>}
      {!loading && records.length === 0 && !error && (
        <p className="border-t border-stone-100 px-5 py-4 text-sm text-stone-600">{t("还没有可查询的数据集。", "No datasets to browse yet.")}</p>
      )}
      {records.length > 0 && (
        <ul className="history-list divide-y divide-stone-100 border-t border-stone-100">
          {records.map((record) => (
            <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold">#{record.id} · {record.source}</div>
                <div className="mt-1 text-xs text-stone-600">
                  {record.owned ? t("我的导入", "My import") : t("共享数据", "Shared dataset")} · {t(`${record.observation_count} 条观测值`, `${record.observation_count} observations`)}
                </div>
              </div>
              <button type="button" className="secondary-button" onClick={() => onExplore(record)}
                disabled={record.observation_count === 0}>
                {t('查看指标', 'View indicators')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
