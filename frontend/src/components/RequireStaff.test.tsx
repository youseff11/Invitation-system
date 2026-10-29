import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { keys } from '@/api/hooks'
import type { ApiUser } from '@/api/types'
import { RequireStaff } from './RequireStaff'

function renderAt(user: ApiUser | null) {
  const client = new QueryClient()
  client.setQueryData(keys.me, user)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="login" element={<p>login page</p>} />
          <Route path="/" element={<p>home page</p>} />
          <Route path="dashboard" element={<RequireStaff />}>
            <Route index element={<p>secret dashboard</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const base: ApiUser = {
  id: 1,
  username: 'u',
  displayName: 'U',
  isStaff: true,
  isSuperuser: false,
}

describe('RequireStaff', () => {
  it('sends anonymous visitors to the login page', () => {
    renderAt(null)
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('sends non-staff users home', () => {
    renderAt({ ...base, isStaff: false })
    expect(screen.getByText('home page')).toBeInTheDocument()
  })

  it('lets staff through', () => {
    renderAt(base)
    expect(screen.getByText('secret dashboard')).toBeInTheDocument()
  })
})
