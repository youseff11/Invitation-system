import ar from '@/i18n/locales/ar/invite.json'
import en from '@/i18n/locales/en/invite.json'

import type { InviteLang } from './types'

/**
 * نصوص واجهة الدعوة (اللي مش جاية من المستند). مايستخدمش i18next عن قصد: الدعوة
 * بتتفتح على موبايل، واللغة بتيجي من الدعوة نفسها (مش من لغة الموقع).
 */
const DICT: Record<InviteLang, unknown> = { ar, en }

export type T = (key: string, vars?: Record<string, string | number>) => string

export function makeT(lang: InviteLang): T {
  const dict = DICT[lang] ?? DICT.ar
  return (key, vars) => {
    let node: unknown = dict
    for (const part of key.split('.')) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    }
    let out = typeof node === 'string' ? node : key
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
    return out
  }
}
