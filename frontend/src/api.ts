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
