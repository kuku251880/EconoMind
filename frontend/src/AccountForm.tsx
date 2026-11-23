import { useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage, submitCredentials } from './api'
import type { Account } from './api'
import { LanguageToggle, useLanguage } from './i18n'
import type { UiText } from './i18n'

export function AccountForm({ initialError, onLogin }: {
  initialError: UiText | null
  onLogin: (account: Account) => void
}) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState(false)
  const [pending, setPending] = useState(false)
  const registering = mode === 'register'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setNotice(false)
    try {
      const account = await submitCredentials(mode, email, password)
      if (registering) {
        setMode('login')
        setPassword('')
        setNotice(true)
      } else {
        onLogin(account)
      }
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  function switchMode() {
    setMode(registering ? 'login' : 'register')
    setPassword('')
    setError(null)
    setNotice(false)
  }

  return (
    <main className="auth-page">
      <div className="auth-topbar">
        <div className="flex items-center gap-3 font-semibold">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="text-lg">EconoMind</span>
        </div>
        <LanguageToggle />
      </div>
      <div className="auth-layout">
        <div className="auth-cover">
          <div className="cover-engraving" aria-hidden="true" />
          <div className="cover-caption">
            <p>{t("经济数据工作台", "Economic data workspace")}</p>
            <p className="cover-title">EconoMind</p>
          </div>
        </div>
        <section className="auth-form">
          <h1 className="auth-title">{registering ? t("创建账号", "Create an account") : t("登录 EconoMind", "Sign in to EconoMind")}</h1>
          <form className="mt-7 space-y-5" onSubmit={submit}>
            <label>{t("邮箱", "Email")}
              <input type="email" placeholder="name@example.com" autoComplete="username" required maxLength={254} value={email}
                onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>{t("密码", "Password")}
              <input type="password" autoComplete={registering ? 'new-password' : 'current-password'}
                minLength={registering ? 12 : undefined} maxLength={128} required value={password}
                onChange={(event) => setPassword(event.target.value)} />
            </label>
            {registering && <p className="text-xs text-stone-600">{t("密码至少 12 个字符。", "Use at least 12 characters.")}</p>}
            {error && <p role="alert" className="text-sm text-red-800">{t(...error)}</p>}
            {notice && <p role="status" className="text-sm text-[#075947]">{t("注册成功，请登录。", "Account created. Please sign in.")}</p>}
            <button type="submit" disabled={pending} className="w-full">
              {registering ? t("注册", "Register") : t("登录", "Sign in")}
            </button>
          </form>
          <button type="button" disabled={pending} className="auth-switch mt-3 w-full" onClick={switchMode}>
            {registering ? t("已有账号，去登录", "Already have an account? Sign in") : t("没有账号，去注册", "Need an account? Register")}
          </button>
        </section>
      </div>
    </main>
  )
}
