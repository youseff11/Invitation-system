import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PORTED } from './ported'

const here = dirname(fileURLToPath(import.meta.url))

/** مكان حفظ جلسة فريق العمل (مسجّلة في .gitignore). */
export const STATE = 'e2e/.auth/staff.json'

export type Target = 'legacy' | 'react'
export const TARGET: Target = process.env.TARGET === 'react' ? 'react' : 'legacy'
/** مسار تطبيق React (لازم يطابق SPA_BASENAME في إعدادات Django). */
export const REACT_BASE = process.env.REACT_BASE ?? '/app'

export interface Variant {
  name: string
  viewport: { width: number; height: number }
  lang: 'ar' | 'en'
  theme: 'light' | 'dark'
}

const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

export const V = {
  mobile: { name: 'mobile', viewport: MOBILE, lang: 'ar', theme: 'light' },
  desktop: { name: 'desktop', viewport: DESKTOP, lang: 'ar', theme: 'light' },
  mobileEnDark: { name: 'mobile-en-dark', viewport: MOBILE, lang: 'en', theme: 'dark' },
  desktopEnDark: { name: 'desktop-en-dark', viewport: DESKTOP, lang: 'en', theme: 'dark' },
} satisfies Record<string, Variant>

export interface PageDef {
  /** اسم ثابت — بيدخل في اسم اللقطة المرجعية */
  id: string
  /** المسار على الموقع القديم */
  path: string
  /** لازم تسجيل دخول من فريق العمل */
  staff: boolean
  variants: Variant[]
  /** اتنقلت لـReact؟ بتتحدد من e2e/ported.ts — وقتها TARGET=react بيقارنها باللقطة. */
  ported: boolean
}

interface RoutesFile {
  templates: { id: number; slug: string }[]
  invitations: {
    id: number
    slug: string
    live: boolean
    locked: boolean
    clientToken: string
    venueToken: string
    guests: { id: number; token: string }[]
  }[]
}

function loadRoutes(): RoutesFile {
  const file = join(here, 'routes.local.json')
  if (!existsSync(file)) {
    throw new Error('e2e/routes.local.json مش موجود — شغّل: python frontend/e2e/dump_routes.py')
  }
  return JSON.parse(readFileSync(file, 'utf-8')) as RoutesFile
}

const PUBLIC_VARIANTS = [V.mobile, V.desktop, V.mobileEnDark]
const STAFF_VARIANTS = [V.mobile, V.desktop]

export function buildPages(): PageDef[] {
  const routes = loadRoutes()
  const pages: PageDef[] = []
  const add = (
    id: string,
    path: string,
    opts: { staff?: boolean; variants?: Variant[] } = {},
  ) =>
    pages.push({
      id,
      path,
      staff: opts.staff ?? false,
      variants: opts.variants ?? (opts.staff ? STAFF_VARIANTS : PUBLIC_VARIANTS),
      ported: PORTED.has(id),
    })

  // ---- الموقع العام
  add('home', '/')
  add('gallery', '/templates/')
  add('login', '/login/')
  for (const t of routes.templates.slice(0, 2)) add(`template-preview-${t.slug}`, `/templates/${t.slug}/preview/`)

  // ---- الدعوات (صفحات الضيوف)
  for (const inv of routes.invitations) {
    if (inv.live && !inv.locked) add(`invite-${inv.slug}`, `/i/${inv.slug}/`)
    const guest = inv.guests[0]
    if (inv.live && guest) {
      add(`invite-${inv.slug}-guest`, `/i/${inv.slug}/g/${guest.token}/`)
      add(`invite-${inv.slug}-pass`, `/i/${inv.slug}/g/${guest.token}/pass/`)
    }
    if (inv.clientToken) add(`invite-${inv.slug}-client`, `/i/${inv.slug}/client/${inv.clientToken}/`)
    if (inv.venueToken) add(`invite-${inv.slug}-venue`, `/i/${inv.slug}/venue/${inv.venueToken}/`)
  }

  // ---- لوحة التحكم
  const staff = { staff: true }
  add('dashboard', '/dashboard/', staff)
  add('dashboard-invitations', '/dashboard/invitations/', staff)
  add('dashboard-invitation-new', '/dashboard/invitations/new/', staff)
  add('dashboard-templates', '/dashboard/templates/', staff)
  add('dashboard-template-new', '/dashboard/templates/new/', staff)
  add('dashboard-fonts', '/dashboard/fonts/', staff)
  add('dashboard-music', '/dashboard/music/', staff)
  add('dashboard-intros', '/dashboard/intros/', staff)
  add('dashboard-plans', '/dashboard/plans/', staff)
  add('dashboard-site', '/dashboard/site/', staff)
  add('dashboard-analytics', '/dashboard/analytics/', staff)
  add('dashboard-orders', '/dashboard/orders/', staff)
  const first = routes.invitations[0]
  if (first) {
    add('dashboard-guests', `/dashboard/invitations/${first.id}/guests/`, staff)
    add('dashboard-guests-qr', `/dashboard/invitations/${first.id}/guests/qr-sheet/`, staff)
    add('dashboard-checkin', `/dashboard/invitations/${first.id}/checkin/`, staff)
    add('editor-invitation', `/dashboard/invitations/${first.id}/editor/`, {
      staff: true,
      variants: [V.desktop],
    })
  }
  const tpl = routes.templates[0]
  if (tpl) {
    add('editor-template', `/dashboard/templates/${tpl.id}/editor/`, { staff: true, variants: [V.desktop] })
  }
  return pages
}

/** المسار الفعلي حسب الهدف */
export function urlFor(page: PageDef, target: Target = TARGET): string {
  return target === 'react' ? `${REACT_BASE}${page.path}` : page.path
}
