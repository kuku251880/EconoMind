import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type UiText = readonly [zh: string, en: string]
type Language = 'zh' | 'en'
type Translate = (...text: UiText) => string
const storageKey = 'economind-language'

const LanguageContext = createContext({
  language: 'zh' as Language,
  t: ((zh) => zh) as Translate,
  toggle: () => {},
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh'
    } catch {
      return 'zh'
    }
  })
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    document.title = language === 'zh' ? 'EconoMind | 经济指标' : 'EconoMind | Economic Indicators'
    try {
      localStorage.setItem(storageKey, language)
    } catch {
      // The current tab can still switch languages without storage.
    }
  }, [language])

  const t: Translate = (zh, en) => language === 'zh' ? zh : en
  return (
    <LanguageContext.Provider value={{ language, t, toggle: () => setLanguage((value) => value === 'zh' ? 'en' : 'zh') }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

export function LanguageToggle() {
  const { t, toggle } = useLanguage()
  return (
    <button type="button" className="secondary-button px-3" onClick={toggle}
      aria-label={t('切换到英文', 'Switch to Simplified Chinese')}>
      <span lang={t('en', 'zh-CN')}>{t('English', '简体中文')}</span>
    </button>
  )
}

export const indicatorLabels: Record<import('./api').IndicatorCode, UiText> = {
  gdp: ['国内生产总值', 'Gross domestic product'],
  primary: ['第一产业增加值', 'Primary industry'],
  secondary: ['第二产业增加值', 'Secondary industry'],
  tertiary: ['第三产业增加值', 'Tertiary industry'],
  online_ytd: ['实物商品网上零售额（累计）', 'Online retail sales of physical goods (YTD)'],
  retail_ytd: ['社会消费品零售总额（累计）', 'Total retail sales of consumer goods (YTD)'],
  online_share_ytd: ['实物网零占社零比重（累计）', 'Online physical goods share of total retail (YTD)'],
  online_qtr: ['实物商品网上零售额（当季）', 'Online retail sales of physical goods (quarter)'],
  retail_qtr: ['社会消费品零售总额（当季）', 'Total retail sales of consumer goods (quarter)'],
  online_share_qtr: ['实物网零占社零比重（当季）', 'Online physical goods share of total retail (quarter)'],
  info_services: ['信息传输、软件和信息技术服务业增加值', 'Information transmission, software and IT services'],
  cpi: ['居民消费价格指数', 'Consumer price index'],
}

export function displayUnit(unit: string, t: Translate) {
  if (unit === '亿元') return t('亿元', '100 million yuan')
  if (unit === '指数点') return t('指数点', 'index points')
  return unit
}
