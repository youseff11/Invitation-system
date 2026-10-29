import { useMutation, useQuery } from '@tanstack/react-query'

import { api } from '@/api/client'
import type { GalleryData, HomeData, OrderFormOptions, OrderPayload } from './types'

export const publicKeys = {
  home: ['public', 'home'] as const,
  gallery: (category?: string) => ['public', 'gallery', category ?? ''] as const,
  orderForm: ['public', 'order-form'] as const,
}

/** الرئيسية كلها في طلب واحد: القوالب والباقات والأسئلة والإعدادات. */
export function usePublicHome() {
  return useQuery({
    queryKey: publicKeys.home,
    queryFn: () => api<HomeData>('/public/home/'),
  })
}

export function useGallery(category?: string) {
  return useQuery({
    queryKey: publicKeys.gallery(category),
    queryFn: () => api<GalleryData>('/public/templates/', { query: { category } }),
  })
}

export function useOrderFormOptions(enabled: boolean) {
  return useQuery({
    queryKey: publicKeys.orderForm,
    queryFn: () => api<OrderFormOptions>('/public/order-form/'),
    enabled,
  })
}

export function useCreateOrder() {
  return useMutation({
    mutationFn: (order: OrderPayload) =>
      api<{ received: true; message: string }>('/orders/', { method: 'POST', body: order }),
  })
}
