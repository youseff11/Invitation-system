import type { ApiUser, Lang, SiteInfo } from '@/api/types'

/**
 * بيانات البداية اللي Django بيحطها في صفحة الـshell
 * (<script id="boot-data" type="application/json">) — شوف system/spa.py.
 * لو الصفحة اتفتحت من غير shell (سيرفر Vite مباشرة) بنرجع قيم افتراضية
 * والـhooks بتجيب البيانات من الـAPI.
 */
export interface Boot {
  basename: string
  lang: Lang
  dir: 'rtl' | 'ltr'
  user: ApiUser | null
  site: SiteInfo | null
  debug: boolean
}

const DEFAULTS: Boot = { basename: '', lang: 'ar', dir: 'rtl', user: null, site: null, debug: false }

export function readBoot(): Boot {
  const node = document.getElementById('boot-data')
  if (!node?.textContent) return DEFAULTS
  try {
    return { ...DEFAULTS, ...(JSON.parse(node.textContent) as Partial<Boot>) }
  } catch {
    return DEFAULTS
  }
}

export const boot: Boot = readBoot()
