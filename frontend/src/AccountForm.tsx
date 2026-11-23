import { useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage, submitCredentials } from './api'
import type { Account } from './api'

export function AccountForm({ initialError, onLogin }: {
  initialError: string
  onLogin: (account: Account) => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const registering = mode === 'register'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    setNotice('')
    try {
      const account = await submitCredentials(mode, email, password)
      if (registering) {
        setMode('login')
        setPassword('')
        setNotice('注册成功，请登录。')
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
    setError('')
    setNotice('')
  }

  return (
    <main className="mx-auto max-w-md px-5 py-16 sm:py-24">
      <div className="mb-8 flex items-center gap-3 font-semibold">
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <span className="text-lg">EconoMind</span>
      </div>
      <section className="panel p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">{registering ? '创建账号' : '登录 EconoMind'}</h1>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <label>邮箱
            <input type="email" autoComplete="username" required maxLength={254} value={email}
              onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>密码
            <input type="password" autoComplete={registering ? 'new-password' : 'current-password'}
              minLength={registering ? 12 : undefined} maxLength={128} required value={password}
              onChange={(event) => setPassword(event.target.value)} />
          </label>
          {registering && <p className="text-xs text-stone-600">密码至少 12 个字符。</p>}
          {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
          {notice && <p role="status" className="text-sm text-[#075947]">{notice}</p>}
          <button type="submit" disabled={pending} className="w-full">
            {registering ? '注册' : '登录'}
          </button>
        </form>
        <button type="button" disabled={pending} className="secondary-button mt-3 w-full" onClick={switchMode}>
          {registering ? '已有账号，去登录' : '没有账号，去注册'}
        </button>
      </section>
    </main>
  )
}
