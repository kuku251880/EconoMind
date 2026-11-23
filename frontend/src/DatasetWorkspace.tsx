import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage, listDatasets, uploadDataset } from './api'
import type { DatasetRecord } from './api'

export function DatasetWorkspace({ onExplore }: {
  onExplore: (record: DatasetRecord) => void
}) {
  const [records, setRecords] = useState<DatasetRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
    setError('')
    setNotice('')
    try {
      const result = await uploadDataset(new FormData(form))
      form.reset()
      setNotice(`已导入数据集 #${result.dataset_id}。`)
      try {
        const updated = await listDatasets()
        setRecords(updated)
        const imported = updated.find((record) => record.id === result.dataset_id)
        if (imported) onExplore(imported)
      } catch {
        setError('文件已导入。请刷新页面以更新导入记录。')
      }
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="panel mb-5 overflow-hidden" aria-labelledby="imports-title">
      <div className="section-heading"><h2 id="imports-title">导入记录</h2></div>
      <form className="grid items-end gap-3 px-5 pb-4 pt-2 sm:grid-cols-[1fr_1.2fr_auto]" onSubmit={upload}>
        <label>数据来源
          <input name="source" required maxLength={200} placeholder="例如：课程样例" />
        </label>
        <label>CSV 文件
          <input type="file" name="file" accept=".csv,text/csv" required
            className="p-2 file:mr-2 file:cursor-pointer file:border-0 file:bg-transparent" />
        </label>
        <button type="submit" disabled={loading || uploading}>{uploading ? '正在导入…' : '导入 CSV'}</button>
        <p className="text-xs text-stone-600 sm:col-span-3">UTF-8 · 最多 2 MiB · 列名 code, period, value</p>
      </form>
      {error && <p role="alert" className="px-5 pb-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="px-5 pb-3 text-sm text-[#075947]">{notice}</p>}
      {loading && <p role="status" className="border-t border-stone-100 px-5 py-4 text-sm">正在读取导入记录…</p>}
      {!loading && records.length === 0 && !error && (
        <p className="border-t border-stone-100 px-5 py-4 text-sm text-stone-600">还没有可查询的数据集。</p>
      )}
      {records.length > 0 && (
        <ul className="divide-y divide-stone-100 border-t border-stone-100">
          {records.map((record) => (
            <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold">#{record.id} · {record.source}</div>
                <div className="mt-1 text-xs text-stone-600">
                  {record.owned ? '我的导入' : '共享数据'} · {record.observation_count} 条观测值
                </div>
              </div>
              <button type="button" className="secondary-button" onClick={() => onExplore(record)}
                disabled={record.observation_count === 0}>
                查看指标
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
