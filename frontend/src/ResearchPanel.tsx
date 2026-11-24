import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage, fetchResearch } from './api'
import type { Filters, ResearchResult } from './api'
import { displayUnit, indicatorLabels, useLanguage } from './i18n'
import type { UiText } from './i18n'

export function ResearchPanel({ filters, canCompare }: { filters: Filters; canCompare: boolean }) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<'question' | 'report'>('question')
  const [question, setQuestion] = useState('')
  const [compare, setCompare] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<UiText | null>(null)
  const [result, setResult] = useState<ResearchResult | null>(null)
  const request = useRef<AbortController | null>(null)
  const sourcePrefix = `research-${filters.datasetId}`

  useEffect(() => () => request.current?.abort(), [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mode === 'question' && !question.trim()) {
      setError(['请输入研究问题。', 'Enter a research question.'])
      return
    }
    const controller = new AbortController()
    request.current = controller
    setError(null)
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
      <h2 id="research-title" className="text-lg font-semibold">{t("AI 研究助手", "AI Research Assistant")}</h2>
      <p className="mt-1 text-sm text-stone-600">
        {t("数据集", "Dataset")} #{filters.datasetId} · {filters.start} {t("至", "to")} {filters.end} · {compare ? t("GDP 与 CPI", "GDP and CPI") : t(...indicatorLabels[filters.code])}
      </p>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-[14rem_1fr] sm:items-end">
          <div>
            <label htmlFor="research-mode">{t("研究方式", "Research mode")}</label>
            <select id="research-mode" value={mode}
              onChange={(event) => { setMode(event.target.value === 'report' ? 'report' : 'question'); setResult(null); setError(null) }}>
              <option value="question">{t("数据问答", "Data Q&A")}</option>
              <option value="report">{t("研究报告初稿", "Research report draft")}</option>
            </select>
          </div>
          {canCompare && <label className="flex items-center gap-2 py-3">
            <input type="checkbox" checked={compare} onChange={(event) => { setCompare(event.target.checked); setResult(null) }}
              className="mt-0 h-4 w-4 accent-[#08715d]" />
            {t("同时纳入 GDP 和 CPI", "Include both GDP and CPI")}
          </label>}
          <label className="sm:col-span-2">
            {mode === 'question' ? t("研究问题", "Research question") : t("报告重点（可选）", "Report focus (optional)")}
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={1000}
              required={mode === 'question'}
              rows={3}
              placeholder={mode === 'question' ? t("例如：最新一季度的同比和环比是多少？", "Example: What were year-over-year and quarter-over-quarter growth in the latest quarter?") : t("例如：总结变化幅度与数据局限", "Example: Summarize changes and data limitations")}
              className="mt-1.5 block w-full rounded-lg border border-[#cdd9d0] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#08715d]"
            />
          </label>
        </fieldset>
        <p className="text-xs text-stone-600">{t("生成时会向 DeepSeek 发送问题和所选范围的观测值。每次最多 40 个季度。", "Your question and selected observations are sent to DeepSeek. Up to 40 quarters per request.")}</p>
        <button type="submit" disabled={pending}>{mode === 'question' ? t("生成回答", "Generate answer") : t("生成报告初稿", "Generate report draft")}</button>
      </form>
      {pending && <p className="mt-4 text-sm" role="status">{t("正在整理数据和引用…", "Preparing data and citations…")}</p>}
      {error && <p className="mt-4 text-sm text-red-800" role="alert">{t(...error)}</p>}
      {result?.status === 'insufficient' && <p className="mt-4 text-sm" role="status">{result.message === '所选指标和季度没有观测值。'
        ? t("所选指标和季度没有观测值。", "There are no observations for the selected indicators and quarters.")
        : t("当前范围内的数据不足以回答这个问题。", "There is not enough evidence in this range to answer the question.")}</p>}
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
            <h3 className="font-semibold">{t("数据引用", "Citations")}</h3>
            <ul className="mt-2 space-y-1 text-sm text-stone-700">
              {result.sources.map((source) => (
                <li key={source.id} id={`${sourcePrefix}-${source.id}`} className="break-words">
                  [{source.id}] {t("数据集", "Dataset")} #{source.dataset_id} · {source.source} · {t(...indicatorLabels[source.code])} · {source.first_period} {t("至", "to")} {source.last_period} · {displayUnit(source.unit, t)}{' '}
                  <a
                    href={`/api/v1/datasets/${source.dataset_id}/indicators/${source.code}/series?${new URLSearchParams({
                      start: source.first_period, end: source.last_period,
                    })}`}
                    target="_blank" rel="noopener noreferrer" className="text-[#075947] underline"
                  >{t("查看观测值", "View observations")}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
