import type { JSX } from 'react'

/**
 * الزخارف والأيقونات — نسخة من ‎templatetags/invite.py‎ (‎_ORNAMENTS‎ و‎_ICONS‎
 * و‎_SOCIAL_ICONS‎). ثابتة ومحصورة بأسماء معروفة: اسم مش موجود = مفيش رسم.
 */
const ORNAMENTS: Record<string, JSX.Element> = {
  line: (
    <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="6" x2="200" y2="6" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  diamond: (
    <svg viewBox="0 0 200 16" aria-hidden="true">
      <line x1="0" y1="8" x2="86" y2="8" stroke="currentColor" strokeWidth="1" />
      <path d="M100 2 L108 8 L100 14 L92 8 Z" fill="currentColor" />
      <line x1="114" y1="8" x2="200" y2="8" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  dots: (
    <svg viewBox="0 0 200 12" aria-hidden="true">
      <circle cx="88" cy="6" r="2" fill="currentColor" />
      <circle cx="100" cy="6" r="3" fill="currentColor" />
      <circle cx="112" cy="6" r="2" fill="currentColor" />
    </svg>
  ),
  floral: (
    <svg viewBox="0 0 200 28" aria-hidden="true">
      <path
        d="M20 14 C50 4 70 24 100 14 C130 4 150 24 180 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path d="M100 8 C104 12 104 16 100 20 C96 16 96 12 100 8 Z" fill="currentColor" />
      <circle cx="74" cy="14" r="1.8" fill="currentColor" />
      <circle cx="126" cy="14" r="1.8" fill="currentColor" />
    </svg>
  ),
  arabesque: (
    <svg viewBox="0 0 200 30" aria-hidden="true">
      <path
        d="M100 4 C112 12 112 18 100 26 C88 18 88 12 100 4 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M100 9 C106 13 106 17 100 21 C94 17 94 13 100 9 Z"
        fill="currentColor"
        opacity=".55"
      />
      <path d="M8 15 C34 5 56 25 82 15" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M118 15 C144 5 166 25 192 15" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
}

export function Ornament({
  variant,
  size = 40,
  slot,
}: {
  variant: unknown
  size?: unknown
  slot?: string
}) {
  const key = String(variant ?? '')
  const svg = Object.hasOwn(ORNAMENTS, key) ? ORNAMENTS[key] : null
  if (!svg) return null
  const n = Number(size)
  const px = Number.isFinite(n) ? Math.max(10, Math.min(400, Math.trunc(n))) : 40
  return (
    <div
      className={`lb-ornament lb-ornament--${key}`}
      data-move={slot || undefined}
      style={{ '--orn-size': `${px}px` } as React.CSSProperties}
      aria-hidden="true"
    >
      {svg}
    </div>
  )
}

/** زخرفة فاصلة قبل/بعد القسم: ‎none‎ أو اسم مجهول = مفيش رسم. */
export function DividerOrnament({
  variant,
  slot,
  size = 44,
}: {
  variant: string
  slot: 'ornament_top' | 'ornament_bottom'
  size?: number
}) {
  if (!variant || variant === 'none') return null
  return <Ornament variant={variant} size={size} slot={slot} />
}

const ICONS: Record<string, JSX.Element> = {
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.7-7.5-9.7A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 3.3C19.5 15.3 12 20 12 20Z" />,
  ring: (
    <>
      <circle cx="12" cy="14" r="6" />
      <path d="M9 6h6l-3 4Z" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="9" width="18" height="12" rx="1.5" />
      <path d="M3 13h18M12 9v12M8.5 9a2.5 2.5 0 1 1 2-4c1 1.3 1.5 2.6 1.5 4M15.5 9a2.5 2.5 0 1 0-2-4c-1 1.3-1.5 2.6-1.5 4" />
    </>
  ),
  phone: (
    <path d="M6 3h3l2 5-2.2 1.4a12 12 0 0 0 5.8 5.8L16 13l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3Z" />
  ),
  star: <path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.8 6.6 19.7l1.2-6.1L3.3 9.4l6.1-.8Z" />,
  music: (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <circle cx="12" cy="13.5" r="3.5" />
      <path d="M9 7l1.5-2h3L15 7" />
    </>
  ),
  cake: (
    <>
      <path d="M4 20h16v-6a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3Z" />
      <path d="M12 8V5M8.5 8V6M15.5 8V6" />
    </>
  ),
  car: (
    <>
      <path d="M4 16h16v-3l-2-5H6l-2 5Z" />
      <circle cx="7.5" cy="18" r="1.6" />
      <circle cx="16.5" cy="18" r="1.6" />
    </>
  ),
  dress: <path d="M9 3h6l-1 4 4 10-2 4H8l-2-4 4-10Z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
}

export function Icon({ name, size = 22 }: { name: unknown; size?: number }) {
  const key = String(name ?? '')
  const body = Object.hasOwn(ICONS, key) ? ICONS[key] : null
  if (!body) return null
  return (
    <svg
      className="lb-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {body}
    </svg>
  )
}

const SOCIAL: Record<string, JSX.Element> = {
  whatsapp: (
    <path
      fill="currentColor"
      d="M12 2a9.9 9.9 0 0 0-8.5 15l-1.3 4.8 4.9-1.3A9.9 9.9 0 1 0 12 2zm0 1.8a8.1 8.1 0 1 1-4.2 15l-.3-.2-2.9.8.8-2.8-.2-.3A8.1 8.1 0 0 1 12 3.8zm-3.4 4c-.2 0-.5.1-.7.4-.2.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.7 4.2 3.7 2.1.8 2.5.7 3 .6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.6-.3s-1.4-.7-1.6-.8c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.2-.1-1-.4-2-1.2-.7-.6-1.2-1.4-1.4-1.7-.1-.2 0-.3.1-.4l.4-.5.3-.5v-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.4z"
    />
  ),
  facebook: (
    <path
      fill="currentColor"
      d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.7-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"
    />
  ),
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="17.2" cy="6.8" r="1.25" fill="currentColor" />
    </>
  ),
}

// الروابط اللي بتوصل الضيف لحتة تانية. أي حاجة غير كده (javascript:…) بتتعرض من غير رابط.
const SOCIAL_HREF = /^(?:https?:\/\/|mailto:|tel:)[^\s"<>]{1,600}$/i

/** أيقونة سوشيال واحدة — بنفس شكل ‎social_link‎ (رابط لو الـhref صالح، وإلا ‎span‎). */
export function SocialLink({
  name,
  href,
  color,
  size,
  label,
}: {
  name: string
  href: string
  color: string
  size: unknown
  label?: string
}) {
  const body = Object.hasOwn(SOCIAL, name) ? SOCIAL[name] : null
  if (!body) return null
  const n = Number(size)
  const px = Number.isFinite(n) ? Math.max(14, Math.min(120, Math.trunc(n))) : 34
  const svg = (
    <svg className="lb-social-icon" width={px} height={px} viewBox="0 0 24 24" aria-hidden="true">
      {body}
    </svg>
  )
  const aria = label || name
  return SOCIAL_HREF.test(href) ? (
    <a
      className="lb-social"
      href={href}
      target="_blank"
      rel="noopener"
      aria-label={aria}
      style={{ color }}
    >
      {svg}
    </a>
  ) : (
    <span className="lb-social" aria-label={aria} style={{ color }}>
      {svg}
    </span>
  )
}
