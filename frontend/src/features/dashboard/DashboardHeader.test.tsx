import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'

import { keys } from '@/api/hooks'
import type { ApiUser, SiteInfo } from '@/api/types'
import { initI18n } from '@/i18n'
import { DashboardHeader } from './DashboardHeader'

const user: ApiUser = { id: 1, username: 'owner', displayName: 'Owner', isStaff: true, isSuperuser: true }
const site = { name: { ar: 'تي ديزاينيشن', en: 'T DESIGNATION' } } as unknown as SiteInfo

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(to)}>go {to}</button>
}

function setup(path = '/dashboard') {
  const client = new QueryClient()
  client.setQueryData(keys.me, user)
  client.setQueryData(keys.site, site)
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <p>outside</p>
        <GoTo to="/dashboard/orders" />
        <Routes>
          <Route path="*" element={<DashboardHeader />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { button: screen.getByRole('button', { name: 'المكتبة' }) }
}

beforeAll(() => {
  initI18n('ar')
})

describe('DashboardHeader library dropdown', () => {
  it('groups fonts, music and intros under one button that starts closed', () => {
    const { button } = setup()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button.closest('.nav-group')).not.toHaveClass('is-open')
    // الروابط التلاتة جوّه القايمة المنسدلة مش في صف الشريط الأساسي
    for (const name of ['الخطوط', 'الموسيقى', 'الافتتاحيات']) {
      expect(screen.getByRole('link', { name }).closest('.nav-sub')).not.toBeNull()
    }
    expect(screen.getByRole('link', { name: 'الدعوات' }).closest('.nav-sub')).toBeNull()
  })

  it('toggles open and closed from the button', () => {
    const { button } = setup()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button.closest('.nav-group')).toHaveClass('is-open')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape and returns focus to the button', () => {
    const { button } = setup()
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
  })

  it('closes when clicking outside but not inside the group', () => {
    const { button } = setup()
    fireEvent.click(button)
    fireEvent.pointerDown(screen.getByRole('link', { name: 'الموسيقى' }))
    expect(button).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes after choosing a link', () => {
    const { button } = setup()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('link', { name: 'الخطوط' }))
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on any navigation, including ones that did not come from the menu', () => {
    const { button } = setup()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: 'go /dashboard/orders' }))
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('highlights the group while a library page is open', () => {
    const { button } = setup('/dashboard/music')
    expect(button).toHaveClass('is-active')
    expect(screen.getByRole('link', { name: 'الموسيقى' })).toHaveClass('is-active')
    expect(screen.getByRole('link', { name: 'الخطوط' })).not.toHaveClass('is-active')
  })

  it('does not highlight the group on other pages', () => {
    const { button } = setup('/dashboard/invitations')
    expect(button).not.toHaveClass('is-active')
  })
})
