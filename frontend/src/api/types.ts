/** أشكال بيانات واجهة ‎/api/v1/‎ — بتتطابق مع system/api/serializers.py. */

export type Lang = 'ar' | 'en'

export interface ApiUser {
  id: number
  username: string
  displayName: string
  isStaff: boolean
  isSuperuser: boolean
}

export interface SiteInfo {
  name: Record<Lang, string>
  tagline: Record<Lang, string>
  displayName: string
  displayTagline: string
  currency: string
  email: string
  ordersEnabled: boolean
  plansPublic: boolean
  /** عدد القوالب في الصف بالرئيسية على التليفون (١ أو ٢) */
  templatesPerRow: 1 | 2
  whatsapp: {
    floatReady: boolean
    url: string
    base: string
    message: string
  }
  facebookUrl: string
  instagramUrl: string
  languages: { code: Lang; label: string }[]
  /** هيرو الرئيسية: خلفيات وكلام قابلين للتعديل (فاضي = الافتراضي المترجم) */
  hero: HeroInfo
}

export interface HeroText {
  top: string
  main: string
  sub: string
  cta: string
  plans: string
  trust: { value: string; label: string }[]
}

export interface HeroInfo {
  images: { lightAr: string; lightEn: string; darkAr: string; darkEn: string }
  text: Record<Lang, HeroText>
}

export interface TemplateCard {
  id: number
  slug: string
  name: string
  nameEn: string
  displayName: string
  description: string
  descriptionEn: string
  displayDescription: string
  category: string
  collection: string
  cover: string | null
}

export interface TemplatesResponse {
  results: TemplateCard[]
  categories: { value: string; label: string }[]
}
