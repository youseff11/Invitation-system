import type { Lang, SiteInfo } from '@/api/types'

/** بطاقة قالب في الرئيسية والمعرض — بتتطابق مع ‎system/api/public.py:_gallery_card‎. */
export interface PublicTemplate {
  id: number
  slug: string
  name: string
  nameEn: string
  displayName: string
  description: string
  descriptionEn: string
  displayDescription: string
  category: string
  /** اسم التصنيف (عربي فقط — زي ‎get_category_display‎ في الموقع القديم) */
  categoryLabel: string
  collection: string
  cover: string | null
}

export interface PlanAddon {
  id: number
  name: string
  nameEn: string
  price: number
}

export interface PublicPlan {
  id: number
  slug: string
  name: string
  nameEn: string
  tagline: string
  taglineEn: string
  price: number
  bullets: string[]
  bulletsEn: string[]
  isFeatured: boolean
  addons: PlanAddon[]
}

export interface PublicFaq {
  id: number
  question: string
  questionEn: string
  answer: string
  answerEn: string
}

export interface HomeData {
  site: SiteInfo
  templates: PublicTemplate[]
  plans: PublicPlan[]
  faqs: PublicFaq[]
}

export interface GalleryData {
  results: PublicTemplate[]
  categories: { value: string; label: string }[]
  category: string
}

export interface OrderFormOptions {
  templates: { id: number; name: string; nameEn: string }[]
  plans: { id: number; name: string; nameEn: string; price: number }[]
  addons: (PlanAddon & { description: string; planIds: number[] })[]
  defaultEventType: string
}

/** جسم ‎POST /api/v1/orders/‎ — نفس حقول ‎OrderForm‎. */
export interface OrderPayload {
  customerName: string
  customerPhone: string
  customerEmail: string
  template: number | null
  plan: number | null
  eventType: string
  eventDate: string
  names: string
  message: string
  addons: number[]
}

export type { Lang }
