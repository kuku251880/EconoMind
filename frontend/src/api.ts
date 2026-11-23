export const indicators = {
  gdp: '国内生产总值',
  cpi: '居民消费价格指数',
} as const

export type IndicatorCode = keyof typeof indicators

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

export interface IndicatorSeries {
  dataset_id: number
  code: IndicatorCode
  source: string
  unit: string
  frequency: string
  points: SeriesPoint[]
}

export async function fetchSeries(filters: Filters, signal: AbortSignal): Promise<IndicatorSeries> {
  const { datasetId, code, start, end } = filters
  const query = new URLSearchParams({ start, end })
  const response = await fetch(
    `/api/v1/datasets/${encodeURIComponent(datasetId)}/indicators/${code}/series?${query}`,
    { signal, headers: { Accept: 'application/json' } },
  )
  if (response.status === 404) throw new Error('找不到该数据集。请核对导入命令返回的编号。')
  if (response.status === 422) throw new Error('查询条件无效。请检查数据集编号和季度范围。')
  if (!response.ok) throw new Error('数据服务暂不可用。请检查后端和数据库是否已启动。')
  return response.json()
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
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null
    const messages: Record<number, string> = {
      401: '请先登录，或检查邮箱和密码。',
      403: '请求未获授权，请刷新后重试。',
      409: '该邮箱已注册，请直接登录。',
      413: 'CSV 文件不能超过 2 MiB。',
      422: typeof body?.detail === 'string' ? body.detail : '请检查输入格式。',
    }
    throw new ApiError(response.status, messages[response.status] ?? '服务暂不可用，请稍后重试。')
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

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : '无法连接服务，请检查后端是否已启动。'
}
