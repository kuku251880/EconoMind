import type { UiText } from './i18n'

export type IndicatorCode = 'gdp' | 'cpi' | 'primary' | 'secondary' | 'tertiary' | 'info_services'
  | 'cpi_index' | 'cpi_yoy' | 'cpi_mom' | 'core_index' | 'core_yoy' | 'core_mom'
  | 'online_ytd' | 'retail_ytd' | 'online_share_ytd' | 'online_qtr' | 'retail_qtr' | 'online_share_qtr'

export interface Filters {
  datasetId: string
  code: IndicatorCode
  start: string
  end: string
}

export interface SeriesPoint {
  period: string
  value: string
  yoy_percent: string | null
  qoq_percent: string | null
}

export interface CatalogRelease {
  period: string
  date: string
  url: string
  share_kind?: string
  survey_base?: string
  edition?: string
}

export interface CatalogVersion {
  id: number
  created_at: string
  end: string
}

export interface CatalogSnapshot {
  rows: { code: IndicatorCode; period: string; value: string }[]
  releases: CatalogRelease[]
}

export interface IndicatorSeries {
  version_id?: number | null
  releases?: CatalogRelease[]
  dataset_id: number
  code: IndicatorCode
  source: string
  unit: string
  frequency: string
  points: SeriesPoint[]
}

export function fetchSeries({ datasetId, code, start, end }: Filters, signal: AbortSignal) {
  const query = new URLSearchParams({ start, end })
  return apiRequest<IndicatorSeries>(
    `/datasets/${encodeURIComponent(datasetId)}/indicators/${code}/series?${query}`,
    { signal, headers: { Accept: 'application/json' } },
  )
}

export interface Account {
  id: number
  email: string
}

export interface DatasetRecord {
  id: number
  source: string
  owned: boolean
  observation_count: number
  codes: IndicatorCode[]
  first_period: string | null
  last_period: string | null
}

class ApiError extends Error {
  constructor(readonly status: number, readonly text: UiText) {
    super(text[1])
  }
}

const apiDetails: Record<string, UiText> = {
  'expected header code,period,value': ['表头应为 code,period,value。', 'Expected the header code,period,value.'],
  'monthly and quarterly observations require separate datasets': ['月度和季度观测值请分别导入。', 'Import monthly and quarterly observations as separate datasets.'],
  'expected a month like 2025-01 with year 0001 to 9999': ['月份格式应类似 2025-01，年份为 0001 至 9999。', 'Use a month such as 2025-01, with a year from 0001 to 9999.'],
  'expected three columns': ['每行应包含三列。', 'Each row must contain three columns.'],
  'unknown indicator code': ['指标代码无效，请参照数据中心下载的 CSV。', 'Unknown indicator code. Check a CSV from the data center.'],
  'expected a quarter like 2025-Q1 with year 0001 to 9999': ['季度格式应类似 2025-Q1，年份为 0001 至 9999。', 'Use a quarter such as 2025-Q1, with a year from 0001 to 9999.'],
  'expected up to 12 integer and 6 decimal digits': ['数值最多有 12 位整数和 6 位小数。', 'Use at most 12 integer digits and 6 decimal places.'],
  'duplicate indicator and quarter': ['该指标和季度重复。', 'This indicator and quarter appear more than once.'],
  'CSV has no observations': ['CSV 没有观测值。', 'The CSV contains no observations.'],
  'CSV must be UTF-8': ['CSV 必须使用 UTF-8 编码。', 'The CSV must use UTF-8 encoding.'],
  'source must be 1 to 200 characters': ['数据来源应为 1 至 200 个字符。', 'The data source must be 1–200 characters.'],
  '季度格式应类似 2025-Q1。': ['季度格式应类似 2025-Q1。', 'Use a quarter such as 2025-Q1.'],
  'AI 尚未配置。请在后端设置 DEEPSEEK_API_KEY。': ['AI 尚未配置。请在后端设置 DEEPSEEK_API_KEY。', 'AI is unavailable. Set DEEPSEEK_API_KEY on the server.'],
  'DeepSeek API Key 无效，请检查后端配置。': ['DeepSeek API Key 无效，请检查后端配置。', 'The DeepSeek API key is invalid. Check the server configuration.'],
  'DeepSeek API 余额不足，请检查账户余额。': ['DeepSeek API 余额不足，请检查账户余额。', 'The DeepSeek API balance is too low. Check the account balance.'],
  'DeepSeek API 请求受限，请稍后重试。': ['DeepSeek API 请求受限，请稍后重试。', 'DeepSeek is rate-limiting requests. Try again later.'],
  'DeepSeek API 暂时无法返回结果，请稍后重试。': ['DeepSeek API 暂时无法返回结果，请稍后重试。', 'DeepSeek could not return a result. Try again later.'],
  'AI 服务暂时无法返回有效结果，请稍后重试。': ['AI 服务暂时无法返回有效结果，请稍后重试。', 'The AI service did not return a valid result. Try again later.'],
  'AI 返回了无法核对来源的内容，请重试。': ['AI 返回了无法核对来源的内容，请重试。', 'The AI returned citations that could not be verified. Try again.'],
}

function apiErrorText(status: number, detail: unknown): UiText {
  if (typeof detail === 'string') {
    if (Object.hasOwn(apiDetails, detail)) return apiDetails[detail]
    if (detail.startsWith('NBS update could not be validated:')) {
      return ['国家统计局页面暂不可用或表格未通过校验。已保留现有版本，可稍后重试。', 'NBS pages were unavailable or failed validation. Existing versions are preserved. Try again later.']
    }
    const row = /^line (\d+): (.+)$/.exec(detail)
    if (row) {
      const reason = Object.hasOwn(apiDetails, row[2]) ? apiDetails[row[2]] : ['CSV 格式无效。', 'Invalid CSV format.']
      return [`第 ${row[1]} 行：${reason[0]}`, `Line ${row[1]}: ${reason[1]}`]
    }
    const limit = /^请选择顺序正确且不超过 (\d+) 个季度的范围。$/.exec(detail)
    if (limit) return [detail, `Select a date range in order of up to ${limit[1]} quarters.`]
  }
  const messages: Record<number, UiText> = {
    401: ['请先登录，或检查邮箱和密码。', 'Sign in, or check your email and password.'],
    403: ['请求未获授权，请刷新后重试。', 'Request not authorized. Refresh and try again.'],
    404: ['找不到该数据集。请核对导入记录中的编号。', 'Dataset not found. Check its ID in Import history.'],
    409: ['该邮箱已注册，请直接登录。', 'This email is already registered. Please sign in.'],
    413: ['CSV 文件不能超过 2 MiB。', 'CSV files must be 2 MiB or smaller.'],
    422: ['请检查输入格式。', 'Check the input format.'],
  }
  return messages[status] ?? ['服务暂不可用，请稍后重试。', 'The service is unavailable. Try again later.']
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null
    throw new ApiError(response.status, apiErrorText(response.status, body?.detail))
  }
  return response.status === 204 ? undefined as T : response.json()
}

const mutationHeaders = { 'X-EconoMind-Request': '1' }

export async function currentAccount(signal: AbortSignal): Promise<Account | null> {
  try {
    return await apiRequest<Account>('/auth/me', { signal })
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export function submitCredentials(mode: 'register' | 'login', email: string, password: string) {
  return apiRequest<Account>(`/auth/${mode}`, {
    method: 'POST',
    headers: { ...mutationHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export function logout() {
  return apiRequest<void>('/auth/logout', { method: 'POST', headers: mutationHeaders })
}

export function listDatasets(signal?: AbortSignal) {
  return apiRequest<DatasetRecord[]>('/datasets', { signal })
}

export function uploadDataset(form: FormData) {
  return apiRequest<{ dataset_id: number }>('/datasets', {
    method: 'POST', headers: mutationHeaders, body: form,
  })
}

export function errorMessage(error: unknown): UiText {
  return error instanceof ApiError
    ? error.text
    : ['无法连接服务，请检查后端是否已启动。', 'Unable to reach the service. Check that the backend is running.']
}

export interface ResearchSection {
  heading: string
  body: string
  source_ids: string[]
}

export interface ResearchSource {
  id: string
  dataset_id: number
  source: string
  code: IndicatorCode
  unit: string
  first_period: string
  last_period: string
}

export interface ResearchResult {
  status: 'answered' | 'insufficient'
  sections: ResearchSection[]
  sources: ResearchSource[]
  message: string | null
}

export function fetchResearch(
  filters: Filters,
  mode: 'question' | 'report',
  question: string,
  compare: boolean,
  signal: AbortSignal,
) {
  return apiRequest<ResearchResult>(`/datasets/${encodeURIComponent(filters.datasetId)}/research`, {
    method: 'POST',
    headers: { ...mutationHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode, question, codes: compare ? ['gdp', 'cpi'] : [filters.code],
      start: filters.start, end: filters.end,
    }),
    signal,
  })
}

interface ForecastMetrics {
  mae: string | null
  rmse: string | null
}

interface ForecastPoint {
  period: string
  baseline: string
  linear_trend: string
}

export interface ForecastComparison {
  unit: string
  evaluated_count: number
  skipped_count: number
  baseline_metrics: ForecastMetrics
  linear_metrics: ForecastMetrics
  predictions: (ForecastPoint & { actual: string })[]
  next_forecast: ForecastPoint | null
}

export function fetchForecast({ datasetId, code, start, end }: Filters, signal: AbortSignal) {
  const query = new URLSearchParams({ start, end })
  return apiRequest<ForecastComparison>(
    `/datasets/${encodeURIComponent(datasetId)}/indicators/${code}/forecast?${query}`, { signal },
  )
}

export function listCatalogVersions(view: string, signal?: AbortSignal) {
  return apiRequest<CatalogVersion[]>(`/catalog/${view}`, { signal })
}

export function getCatalogVersion(view: string, id: number, signal?: AbortSignal) {
  return apiRequest<CatalogSnapshot>(`/catalog/${view}/versions/${id}`, { signal })
}

export function checkCatalog(view: string) {
  return apiRequest<{ id: number; changed: boolean; end: string }>(`/catalog/${view}/check`, { method: 'POST', headers: mutationHeaders })
}

export function importCatalogVersion(view: string, id: number, start: string, end: string) {
  return apiRequest<{ dataset_id: number }>(`/catalog/${view}/versions/${id}/import`, {
    method: 'POST', headers: { ...mutationHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ start, end }),
  })
}
