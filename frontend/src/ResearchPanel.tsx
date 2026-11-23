import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage, fetchResearch, indicators } from './api'
import type { Filters, ResearchResult } from './api'

export function ResearchPanel({ filters }: { filters: Filters }) {
  const [mode, setMode] = useState<'question' | 'report'>('question')
  const [question, setQuestion] = useState('')
  const [compare, setCompare] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ResearchResult | null>(null)
  const request = useRef<AbortController | null>(null)
  const sourcePrefix = `research-${filters.datasetId}`

  useEffect(() => () => request.current?.abort(), [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mode === 'question' && !question.trim()) {
      setError('请输入研究问题。')
      return
    }
    const controller = new AbortController()
    request.current = controller
    setError('')
    setResult(null)
    setPending(true)
    try {
      const response = await fetchResearch(filters, mode, question.trim(), compare, controller.signal)
      if (!controller.signal.aborted) setResult(response)
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure))
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <section className="panel mt-5 p-5" aria-labelledby="research-title">
      <h2 id="research-title" className="text-lg font-semibold">AI 研究助手</h2>
      <p className="mt-1 text-sm text-stone-600">
        数据集 #{filters.datasetId} · {filters.start} 至 {filters.end} · {compare ? 'GDP 与 CPI' : indicators[filters.code]}
      </p>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-[14rem_1fr] sm:items-end">
          <div>
            <label htmlFor="research-mode">研究方式</label>
            <select id="research-mode" value={mode}
              onChange={(event) => { setMode(event.target.value === 'report' ? 'report' : 'question'); setResult(null); setError('') }}>
              <option value="question">数据问答</option>
              <option value="report">研究报告初稿</option>
            </select>
          </div>
          <label className="flex items-center gap-2 py-3">
            <input type="checkbox" checked={compare} onChange={(event) => { setCompare(event.target.checked); setResult(null) }}
              className="mt-0 h-4 w-4 accent-[#08715d]" />
            同时纳入 GDP 和 CPI
          </label>
          <label className="sm:col-span-2">
            {mode === 'question' ? '研究问题' : '报告重点（可选）'}
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={1000}
              required={mode === 'question'}
              rows={3}
              placeholder={mode === 'question' ? '例如：最新一季度的同比和环比是多少？' : '例如：总结变化幅度与数据局限'}
              className="mt-1.5 block w-full rounded-lg border border-[#cdd9d0] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#08715d]"
            />
          </label>
        </fieldset>
        <p className="text-xs text-stone-600">生成时会向 DeepSeek 发送问题和所选范围的观测值。每次最多 40 个季度。</p>
        <button type="submit" disabled={pending}>{mode === 'question' ? '生成回答' : '生成报告初稿'}</button>
      </form>
      {pending && <p className="mt-4 text-sm" role="status">正在整理数据和引用…</p>}
      {error && <p className="mt-4 text-sm text-red-800" role="alert">{error}</p>}
      {result?.status === 'insufficient' && <p className="mt-4 text-sm" role="status">{result.message}</p>}
      {result?.status === 'answered' && (
        <div className="mt-5 space-y-4 border-t border-stone-200 pt-4">
          {result.sections.map((section, index) => (
            <div key={index}>
              <h3 className="font-semibold">{section.heading}</h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                {section.body}{' '}
                {[...new Set(section.source_ids)].map((id) => (
                  <a key={id} href={`#${sourcePrefix}-${id}`} className="mr-1 text-[#075947] underline">[{id}]</a>
                ))}
              </p>
            </div>
          ))}
          <div>
            <h3 className="font-semibold">数据引用</h3>
            <ul className="mt-2 space-y-1 text-sm text-stone-700">
              {result.sources.map((source) => (
                <li key={source.id} id={`${sourcePrefix}-${source.id}`} className="break-words">
                  [{source.id}] 数据集 #{source.dataset_id} · {source.source} · {indicators[source.code]} · {source.first_period} 至 {source.last_period} · {source.unit}{' '}
                  <a
                    href={`/api/v1/datasets/${source.dataset_id}/indicators/${source.code}/series?${new URLSearchParams({
                      start: source.first_period, end: source.last_period,
                    })}`}
                    target="_blank" rel="noopener noreferrer" className="text-[#075947] underline"
                  >查看观测值</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
