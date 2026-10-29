import { beforeEach, describe, expect, it } from 'vitest'

import { useTheme } from './theme'

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear()
    useTheme.getState().set('light')
  })

  it('toggles between light and dark and mirrors it on <html>', () => {
    useTheme.getState().toggle()
    expect(useTheme.getState().theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    useTheme.getState().toggle()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('persists the choice under the same key the legacy site uses', () => {
    useTheme.getState().set('dark')
    expect(localStorage.getItem('leila-theme')).toBe('dark')
  })
})
