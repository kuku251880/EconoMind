import type { CatalogRelease, IndicatorCode } from './api'
import { indicatorLabels } from './i18n'
import type { UiText } from './i18n'
import releases from './catalog/china-national-accounts.json'
import { priceEntry } from './prices'
import { retailMethod, retailReleases, retailRows, retailSource } from './retail'
import quarterly from './catalog/sample-quarterly.csv?raw'
import forecast from './catalog/sample-forecast.csv?raw'

export type Category = 'macro' | 'industry' | 'digital' | 'teaching'
export const categories: Record<Category, UiText> = {
  macro: ['宏观经济', 'Macroeconomy'],
  industry: ['产业结构', 'Industry structure'],
  digital: ['数字经济', 'Digital economy'],
  teaching: ['教学样例', 'Teaching samples'],
}

// These checked-in snapshots contain only indicator codes, quarters and decimal numbers.
function readSnapshot(csv: string) {
  return csv.trim().split(/\r?\n/).slice(1).map(line => {
    const [code, period, value] = line.split(',')
    if (code !== 'gdp' && code !== 'cpi') throw new Error('Unknown catalog indicator: ' + code)
    return { code: code as IndicatorCode, period, value }
  })
}

export interface CatalogEntry {
  id: string
  category: Category
  title: UiText
  kind: UiText
  publisher: UiText
  method: UiText
  source: string
  releases?: CatalogRelease[]
  rows: ReturnType<typeof readSnapshot>
}

const sampleKind: UiText = ['教学样例', 'Teaching sample']
const legacyGDPSource = '国家统计局 · 2025年中国季度GDP各季初步核算表1 · 现价当季金额（亿元），名义同比及环比，未季调'
type AccountsCode = 'gdp' | 'primary' | 'secondary' | 'tertiary' | 'info_services'

function officialEntry(id: string, category: Category, title: UiText, codes: AccountsCode[]): CatalogEntry {
  return {
    id, category, title, kind: ['官方数据', 'Official data'],
    publisher: ['国家统计局', 'National Bureau of Statistics of China'],
    method: ['各季首次公布的初步核算表 1，当季现价绝对额（亿元），全国范围不含港澳台。增速按名义金额计算，环比未季调。历年首次发布值可能跨越核算修订，占比采用同季同表 GDP。',
      'First preliminary release for each quarter, Table 1. Current-price quarterly amounts in 100 million yuan for mainland China. Growth is nominal and unadjusted. Release vintages can span revisions. Shares use GDP from the same table and quarter.'],
    source: '国家统计局 · ' + title[0] + ' · 2023–2025 各季初步核算表1 · 当季现价亿元，未季调',
    releases,
    rows: releases.flatMap(row => codes.map(code => ({ code, period: row.period, value: row[code] }))),
  }
}

export const catalog: CatalogEntry[] = [
  priceEntry,
  officialEntry('china-gdp', 'macro', ['中国 GDP · 季度数据', 'China GDP · Quarterly data'], ['gdp']),
  officialEntry('china-industries', 'industry', ['三次产业季度增加值', 'Quarterly value added by industry'],
    ['primary', 'secondary', 'tertiary', 'gdp']),
  officialEntry('china-info-services', 'digital',
    ['信息传输、软件和信息技术服务业季度增加值', 'Information transmission, software and IT services'],
    ['info_services', 'tertiary', 'gdp']),
  {
    id: 'china-online-retail', category: 'digital', title: ['网上零售与数字消费', 'Online retail and digital consumption'],
    kind: ['官方数据', 'Official data'], publisher: ['国家统计局', 'National Bureau of Statistics of China'],
    source: retailSource, method: retailMethod, releases: retailReleases, rows: retailRows,
  },
  {
    id: 'sample-quarterly', category: 'teaching', title: ['GDP 与 CPI 季度指标', 'Quarterly GDP and CPI'],
    kind: sampleKind, publisher: ['EconoMind 课程样例', 'EconoMind course materials'],
    method: ['合成数据，用于练习指标查询。序列含缺失季度和零基期，可观察同比、环比的可用范围。',
      'Synthetic GDP and consumer price index observations with missing quarters and a zero base for practicing growth calculations.'],
    source: 'EconoMind · GDP 与 CPI 季度指标（合成教学样例）', rows: readSnapshot(quarterly),
  },
  {
    id: 'sample-forecast', category: 'teaching', title: ['季度 GDP 预测与回测', 'Quarterly GDP forecasting and backtesting'],
    kind: sampleKind, publisher: ['EconoMind 课程样例', 'EconoMind course materials'],
    method: ['十个连续季度的合成 GDP 金额（亿元），用于比较趋势模型和上一季度基线。',
      'Ten consecutive quarters of synthetic GDP in 100 million yuan for comparing a trend model with a previous-quarter baseline.'],
    source: 'EconoMind · 季度 GDP 预测与回测（合成教学样例）', rows: readSnapshot(forecast),
  },
]

export function matches(entry: CatalogEntry, search: string) {
  const codes = [...new Set(entry.rows.map(row => row.code))]
  const text = [entry.id, ...codes.flatMap(code => [code, ...indicatorLabels[code]]), ...entry.title, ...entry.kind, ...entry.publisher, ...entry.method,
    ...entry.rows.map(row => row.period)].join(' ').normalize('NFKC').toLowerCase()
  const compact = text.replace(/\s+/g, '')
  return search.normalize('NFKC').toLowerCase().trim().split(/\s+/).every(word => text.includes(word) || compact.includes(word))
}

export function accountsReleases(source: string) {
  return source === legacyGDPSource || catalog.some(entry => entry.releases === releases && entry.source === source) ? releases : undefined
}
