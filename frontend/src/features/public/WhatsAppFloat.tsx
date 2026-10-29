import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useSite } from '@/api/hooks'
import { CheckDoubleIcon, WhatsAppIcon } from './icons'
import { useLang } from './text'

function CloseIcon() {
  return (
    <svg className="wa-x" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

function clockLabel(lang: 'ar' | 'en'): string {
  const now = new Date()
  try {
    return now.toLocaleTimeString(lang === 'en' ? 'en-US' : 'ar-EG', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
  }
}

/**
 * زر واتساب العائم + نافذة شات شبه واتساب (نفس ‎partials/_whatsapp_float.html‎ و
 * ‎site.js‎): الضغطة بتفتح النافذة، والزائر يكتب رسالته ويدوس «إرسال» فتتفتح
 * محادثة واتساب بالرسالة جاهزة. لو ماكتبش حاجة بتتبعت الرسالة الافتراضية من
 * إعدادات الموقع. من غير رقم، الزر بيفضل لينك عادي. بيظهر بس لو ‎floatReady‎.
 */
export function WhatsAppFloat() {
  const { t } = useTranslation()
  const lang = useLang()
  const { data: site } = useSite()
  const wa = site?.whatsapp
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [time, setTime] = useState('')
  const buttonRef = useRef<HTMLAnchorElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const ready = !!wa?.floatReady

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus({ preventScroll: true })
    }
    // ضغطة برّه النافذة والزر بتقفلها — زي أي قايمة منبثقة
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (chatRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  if (!ready || !wa) return null

  function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    setTime(clockLabel(lang))
    setOpen(true)
    // على الموبايل الفوكس بيطلّع الكيبورد ويغطي نص الشاشة — فبنسيبه للزائر
    // يدوس على الخانة بنفسه. على الكمبيوتر نبدأ في الكتابة على طول.
    if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const message = text.trim() || wa!.message
    const url = wa!.base + (message ? `?text=${encodeURIComponent(message)}` : '')
    // من غير "noopener" في الخيارات: معاه ‎window.open‎ بيرجّع ‎null‎ دايماً
    // فماكناش هنعرف لو النافذة اتمنعت فعلاً.
    const win = window.open(url, '_blank')
    if (win) {
      try {
        win.opener = null
      } catch {
        /* نافذة من أصل تاني */
      }
    } else {
      // متصفحات جوّه التطبيقات (فيسبوك/إنستجرام) ساعات بتمنع النوافذ الجديدة
      window.location.href = url
    }
    setText('')
    setOpen(false)
  }

  const label = t('public.whatsapp.label')

  return (
    <>
      <a
        ref={buttonRef}
        className={'wa-float' + (open ? ' is-open' : '')}
        href={wa.url}
        target="_blank"
        rel="noopener"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="wa-chat"
        aria-label={label}
        title={label}
        onClick={(event) => {
          if (!wa.base) return // مفيش رقم؟ اللينك العادي يشتغل
          event.preventDefault()
          toggle()
        }}
      >
        <WhatsAppIcon className="wa-icon" />
        <span className="wa-icon--close">
          <CloseIcon />
        </span>
      </a>

      <div
        ref={chatRef}
        className={'wa-chat' + (open ? ' is-in' : '')}
        id="wa-chat"
        hidden={!open}
        role="dialog"
        aria-label={label}
      >
        <header className="wa-chat-head">
          <img className="wa-chat-avatar" src="/static/images/logo.jpeg" alt="" width="46" height="46" />
          <div className="wa-chat-who">
            <strong>فرحة</strong>
            <small>{t('public.whatsapp.status')}</small>
          </div>
          <button
            type="button"
            className="wa-chat-close"
            aria-label={t('public.whatsapp.close')}
            onClick={() => {
              setOpen(false)
              buttonRef.current?.focus({ preventScroll: true })
            }}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="wa-chat-body">
          <div className="wa-bubble">
            <p>{t('public.whatsapp.greeting')}</p>
            <span className="wa-bubble-time">
              <CheckDoubleIcon />
              <time>{time}</time>
            </span>
          </div>
        </div>

        <form className={'wa-chat-foot' + (text.trim() ? ' has-text' : '')} onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            name="message"
            maxLength={500}
            autoComplete="off"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('public.whatsapp.placeholder')}
            aria-label={t('public.whatsapp.input')}
          />
          <button type="submit" className="wa-chat-send" aria-label={t('public.whatsapp.send')}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M3.4 20.4l17.4-7.5a1 1 0 000-1.8L3.4 3.6a1 1 0 00-1.4 1.1L4 11l9 1-9 1-2 6.3a1 1 0 001.4 1.1z"
                fill="currentColor"
              />
            </svg>
          </button>
        </form>
      </div>
    </>
  )
}
