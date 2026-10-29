import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { useLogin, useMe, useSite } from '@/api/hooks'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { pick, useLang } from './text'

/** صفحة الدخول — بشكل القديم (‎auth/login.html‎): كارت في النص بلوجو الموقع، من غير ترويسة. */
export function LoginPage() {
  const { t } = useTranslation()
  const lang = useLang()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: user } = useMe()
  const { data: site } = useSite()
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const siteName = site ? pick(lang, site.name.ar, site.name.en) : ''
  useDocumentTitle(t('public.title.login', { name: siteName }))

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'
  if (user) return <Navigate to={from} replace />

  function submit(event: FormEvent) {
    event.preventDefault()
    login.mutate({ username, password }, { onSuccess: () => navigate(from, { replace: true }) })
  }

  const error = login.error
  const message =
    error instanceof ApiError
      ? error.status === 429
        ? t('public.login.tooMany')
        : error.status === 400 && error.code === 'invalid_credentials'
          ? t('public.login.invalid')
          : error.message || t('errors.generic')
      : error
        ? t('errors.network')
        : ''

  return (
    <div className="login-page">
      <div className="login-card card">
        <Link className="brand brand--stacked" to="/">
          <span className="sr-only">{siteName}</span>
        </Link>
        <h2>{t('public.login.title')}</h2>
        {message && (
          <div className="flash flash--error" role="alert">
            {message}
          </div>
        )}
        <form className="form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="id_username">{t('public.login.username')}</label>
            <input
              id="id_username"
              name="username"
              autoFocus
              autoCapitalize="none"
              autoComplete="username"
              maxLength={150}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="id_password">{t('public.login.password')}</label>
            <input
              id="id_password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn--gold btn--block" type="submit" disabled={login.isPending}>
            {login.isPending ? t('public.login.submitting') : t('public.login.submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
