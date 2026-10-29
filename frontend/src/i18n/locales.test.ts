import { describe, expect, it } from 'vitest'

import { resources } from './index'

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('locales', () => {
  it('Arabic and English define exactly the same keys', () => {
    const ar = flatten(resources.ar.translation).sort()
    const en = flatten(resources.en.translation).sort()
    expect(en).toEqual(ar)
  })

  it('no message is empty', () => {
    for (const lang of ['ar', 'en'] as const) {
      const empty = flatten(resources[lang].translation).filter((key) => {
        const value = key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], resources[lang].translation)
        return typeof value === 'string' && value.trim() === ''
      })
      expect(empty, `${lang} has empty messages`).toEqual([])
    }
  })
})
