import { describe, expect, it } from 'vitest'

import { resources } from '@/i18n'

// كود اللوحة كنص خام (من غير ملفات الاختبار نفسها) — عشان نفحص المفاتيح اللي بيستخدمها
const sources = import.meta.glob<string>('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

function lookup(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree)
}

/** كل ‎t('dashboard.…')‎ و‎i18nKey="dashboard.…"‎ مكتوب نصاً في كود اللوحة. */
function usedKeys(): Map<string, string> {
  const used = new Map<string, string>()
  for (const [file, source] of Object.entries(sources)) {
    if (/\.test\.tsx?$/.test(file)) continue
    for (const match of source.matchAll(/(?:\bt\(|i18nKey=)\s*['"]((?:dashboard)\.[\w.]+)['"]/g)) {
      used.set(match[1], file)
    }
  }
  return used
}

const ar = resources.ar.translation
const en = resources.en.translation

describe('dashboard locales', () => {
  it('finds the keys the components use (sanity check for the scanner)', () => {
    expect(usedKeys().size).toBeGreaterThan(150)
  })

  it('defines every literal key in both languages', () => {
    const missing: string[] = []
    for (const [key, file] of usedKeys()) {
      for (const [lang, tree] of [['ar', ar], ['en', en]] as const) {
        if (typeof lookup(tree, key) !== 'string') missing.push(`${lang}: ${key} (${file.split(/[\\/]/).pop()})`)
      }
    }
    expect(missing).toEqual([])
  })

  it('defines the keys that are built at runtime', () => {
    const dynamic: string[] = [
      ...['draft', 'review', 'published', 'archived', 'new', 'contacted', 'in_progress', 'completed', 'cancelled', 'attending', 'declined', 'maybe'].map((v) => `status.${v}`),
      ...['none', 'wedding', 'engagement', 'henna', 'katb_ketab', 'birthday', 'graduation', 'aqiqah', 'corporate', 'other'].map((v) => `categories.${v}`),
      ...['builtin', 'editor', 'import'].map((v) => `sources.${v}`),
      ...['normal', 'italic'].map((v) => `fontStyles.${v}`),
      ...['زفاف', 'خطوبة', 'كتب كتاب', 'حنة', 'عيد ميلاد', 'تخرّج', 'عقيقة'].map((v) => `eventTypes.${v}`),
      ...['home', 'invitations', 'templates', 'fonts', 'music', 'videos', 'intros', 'orders', 'plans', 'analytics'].map((v) => `nav.${v}`),
      ...['invitations', 'published', 'ordersNew', 'customers', 'templates', 'guests', 'attending', 'views'].map((v) => `home.stats.${v}`),
      ...['fonts', 'music', 'videos', 'intros'].flatMap((kind) => ['confirmDelete', 'deleted', 'shownDone', 'hiddenDone'].map((v) => `${kind}.${v}`)),
      ...['name', 'category', 'collection', 'slug', 'description', 'coverImage', 'coverUrl'].map((v) => `templateNew.fields.${v}`),
      ...['templates.shown', 'templates.hiddenDone', 'plans.addonSaved', 'plans.addonAdded', 'plans.enabled', 'plans.disabled'],
    ]
    const missing = dynamic.filter((key) => [ar, en].some((tree) => typeof lookup(tree, `dashboard.${key}`) !== 'string'))
    expect(missing).toEqual([])
  })

  it('keeps interpolation placeholders identical between Arabic and English', () => {
    const placeholders = (value: string) => [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort()
    const walk = (a: unknown, b: unknown, path: string, bad: string[]) => {
      if (typeof a === 'string' && typeof b === 'string') {
        if (placeholders(a).join() !== placeholders(b).join()) bad.push(path)
      } else if (a && typeof a === 'object' && b && typeof b === 'object') {
        for (const key of Object.keys(a)) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`, bad)
      }
    }
    const bad: string[] = []
    walk(lookup(ar, 'dashboard'), lookup(en, 'dashboard'), 'dashboard', bad)
    expect(bad).toEqual([])
  })
})
