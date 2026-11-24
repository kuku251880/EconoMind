import type { IndicatorCode } from './api'
import type { CatalogEntry } from './catalog'
import releases from './catalog/china-monthly-cpi.json'

export const priceCodes = ['cpi_index', 'cpi_yoy', 'cpi_mom', 'core_index', 'core_yoy', 'core_mom'] as const
export function isPriceCode(code: IndicatorCode) {
  return priceCodes.some(item => item === code)
}
export const priceSource = '国家统计局 · 2025 全国月度 CPI 与核心 CPI · 官方同比、环比；指数由同比换算（上年同月＝100）'
export const priceEntry: CatalogEntry = {
  id: 'china-monthly-cpi', category: 'macro',
  title: ['月度 CPI 与核心 CPI', 'Monthly CPI and core CPI'],
  kind: ['官方数据', 'Official data'], publisher: ['国家统计局', 'National Bureau of Statistics of China'],
  method: [
    '核心 CPI 扣除食品和能源。同比、环比为发布表原值（%）。指数＝100＋官方同比，基准是各期的上年同月，不能作为固定基期价格水平跨月比较。',
    'Core CPI excludes food and energy. Published year-on-year and month-on-month changes are percentages. Index = 100 + published year-on-year change. Its base is the same month one year earlier for each observation.',
  ],
  source: priceSource, releases,
  rows: releases.flatMap(row => priceCodes.map(code => {
    const value = code === 'cpi_index' ? (100 + Number(row.cpi_yoy)).toFixed(1)
      : code === 'core_index' ? (100 + Number(row.core_yoy)).toFixed(1) : row[code]
    return { code, period: row.period, value }
  })),
}
