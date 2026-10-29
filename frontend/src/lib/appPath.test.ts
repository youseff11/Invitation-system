import { describe, expect, it, vi } from 'vitest'

describe('appPath', () => {
  it('strips the router basename and leaves everything else alone', async () => {
    vi.resetModules()
    vi.doMock('@/app/boot', () => ({ boot: { basename: '/app' } }))
    const { appPath } = await import('./appPath')
    expect(appPath('/app/dashboard/invitations/3/editor')).toBe('/dashboard/invitations/3/editor')
    expect(appPath('/dashboard/invitations/3/editor')).toBe('/dashboard/invitations/3/editor')
    expect(appPath('/application/x')).toBe('/application/x')
  })

  it('is a no-op at the site root', async () => {
    vi.resetModules()
    vi.doMock('@/app/boot', () => ({ boot: { basename: '' } }))
    const { appPath } = await import('./appPath')
    expect(appPath('/dashboard/templates/9/editor')).toBe('/dashboard/templates/9/editor')
  })
})
