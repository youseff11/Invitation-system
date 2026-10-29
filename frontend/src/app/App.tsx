import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { boot } from './boot'
import { routes } from './routes'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // أخطاء 4xx مش هتتصلّح بإعادة المحاولة
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
    },
  })
}

// basename فاضي = الجذر. React Router بيرفض '' فبنمرّر undefined.
const router = createBrowserRouter(routes, { basename: boot.basename || undefined })

export function App() {
  const [queryClient] = useState(makeQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
