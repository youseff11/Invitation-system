import { useMemo, useState, type FormEvent } from 'react'

import { ApiError } from '@/api/client'

import { fetchRender, unlockInvitation } from './api'
import { InviteContext } from './context'
import { makeT } from './strings'
import type { RenderPayload } from './types'

/**
 * صفحة كلمة السر — بديل ‎locked.html‎ القديم. الدعوة المحمية مابتبعتش أي بيانات
 * قبل ما الضيف يدخل الكلمة؛ والجلسة (‎inv_ok_<pk>‎) بتتسجّل على السيرفر.
 */
export function Locked({ slug, onUnlocked }: { slug: string; onUnlocked: (payload: RenderPayload) => void }) {
  const t = useMemo(() => makeT('ar'), [])
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await unlockInvitation(slug, password)
      const lang = new URLSearchParams(location.search).get('lang') ?? ''
      const payload = await fetchRender({ kind: 'invitation', slug }, lang === 'en' ? 'en' : lang === 'ar' ? 'ar' : '')
      onUnlocked(payload)
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError && err.status === 401) setError(t('lock.wrong'))
      else if (err instanceof ApiError && err.status === 429) setError(t('lock.tooMany'))
      else setError(t('lock.error'))
    }
  }

  return (
    <InviteContext.Provider value={{ lang: 'ar', t, maxWidth: 0, demo: false, hasIntro: false }}>
      <main className="lb-lock">
        <form className="lb-lock-card" onSubmit={submit}>
          <h1>{t('lock.title')}</h1>
          <p className="lb-lock-hint">{t('lock.hint')}</p>
          {error && (
            <div className="lb-lock-error" role="alert">
              {error}
            </div>
          )}
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="off"
            placeholder={t('lock.placeholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="lb-btn lb-btn--solid lb-btn--block" disabled={busy}>
            {t('lock.submit')}
          </button>
        </form>
      </main>
    </InviteContext.Provider>
  )
}
