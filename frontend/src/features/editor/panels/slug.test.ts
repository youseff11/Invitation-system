import { describe, expect, it } from 'vitest'

import { cleanSlug, SLUG_MIN } from './slug'

describe('cleanSlug', () => {
  it('lowercases, trims and turns anything outside a-z 0-9 _ - into a single dash', () => {
    expect(cleanSlug('  Ahmed Sara  ')).toBe('ahmed-sara')
    expect(cleanSlug('Ahmed   &   Sara!!')).toBe('ahmed-sara')
    expect(cleanSlug('wedding_2030')).toBe('wedding_2030')
  })

  it('collapses repeated dashes and strips them from both ends', () => {
    expect(cleanSlug('--a---b--')).toBe('a-b')
    expect(cleanSlug('---')).toBe('')
  })

  it('drops non-latin letters and limits the length to 60', () => {
    expect(cleanSlug('عرس-ahmed')).toBe('ahmed')
    expect(cleanSlug('عرس')).toBe('')
    expect(cleanSlug('a'.repeat(80))).toHaveLength(60)
  })

  it('is safe on empty input', () => {
    expect(cleanSlug('')).toBe('')
    expect(SLUG_MIN).toBe(3)
  })
})
