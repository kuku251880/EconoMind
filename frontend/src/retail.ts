import type { IndicatorCode } from './api'
import type { UiText } from './i18n'
import retailReleases from './catalog/china-online-retail.json'

export { retailReleases }
export const retailSource = '国家统计局 · 2023–2025 年季末社会消费品零售总额发布 · 年内累计原值、当季差分及同口径实物网零占比'
export const retailMethod: UiText = [
  '累计为年初至季末，金额与占比取季末发布的表格和正文。当季为该季度三个月：一季度沿用累计金额，其余季度以本期累计减同年上期累计。用当季实物网零额除以当季社零总额推算占比。金额为亿元；取整和统计修订会影响差值，跨年金额推算的增速可能与官方可比增速不同。',
  'YTD amounts and shares come from the quarter-end NBS table and release text. A quarter covers three months. Q1 uses the YTD amounts; later quarters use differences between consecutive releases in the same year. Quarterly share divides physical goods sold online by total retail sales for that quarter. Amounts are in 100 million yuan. Rounding and revisions can affect differences and comparisons across years.',
]
export const retailGroups = {
  ytd: ['online_ytd', 'retail_ytd', 'online_share_ytd'],
  qtr: ['online_qtr', 'retail_qtr', 'online_share_qtr'],
} as const
export function retailBasis(code: IndicatorCode) {
  if (retailGroups.ytd.some(c => c === code)) return 'ytd'
  if (retailGroups.qtr.some(c => c === code)) return 'qtr'
  return null
}

export interface RetailRow { code: IndicatorCode; period: string; value: string }

export const retailRows = retailReleases.flatMap((r, index): RetailRow[] => {
  const quarter = Number(r.period.at(-1))
  const previous = quarter === 1 ? undefined : retailReleases[index - 1]
  if (quarter !== 1 && previous?.period !== r.period.slice(0, -1) + (quarter - 1)) {
    throw new Error('Missing prior cumulative release for ' + r.period)
  }
  const online = r.online_ytd - (previous?.online_ytd ?? 0)
  const total = r.retail_ytd - (previous?.retail_ytd ?? 0)
  const figures = { online_ytd: String(r.online_ytd), retail_ytd: String(r.retail_ytd),
    online_share_ytd: r.online_share_ytd, online_qtr: String(online), retail_qtr: String(total),
    online_share_qtr: (100 * online / total).toFixed(2) }
  return [...retailGroups.ytd, ...retailGroups.qtr].map(code => ({ code, period: r.period, value: figures[code] }))
})
