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

export const indicatorLabels: Record<"gdp" | "cpi", UiText> = {
  gdp: ['国内生产总值', 'Gross domestic product'],
  cpi: ['居民消费价格指数', 'Consumer price index'],
}

export function displayUnit(unit: string, t: Translate) {
  if (unit === '亿元') return t('亿元', '100 million yuan')
  if (unit === '指数点') return t('指数点', 'index points')
  return unit
}
