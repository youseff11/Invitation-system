/** أشكال بيانات ‎/api/v1/dashboard/‎ — بتتطابق مع system/api/dashboard*.py. */

export interface Choice {
  value: string
  label: string
}

export interface OverviewResponse {
  stats: {
    invitations: number
    published: number
    ordersNew: number
    customers: number
    templates: number
    guests: number
    attending: number
    views: number
  }
  recentInvitations: {
    id: number
    title: string
    customerName: string
    templateName: string
    status: string
    editorUrl: string
  }[]
  recentRsvps: {
    id: number
    name: string
    invitationTitle: string
    status: string
    companions: number
    createdLabel: string
  }[]
}

export interface AnalyticsResponse {
  totals: { views: number; attending: number; declined: number }
  invitations: { id: number; title: string; status: string; views: number; rsvps: number; guests: number }[]
  chart: { label: string; views: number; rsvps: number }[]
}

export interface OrderRow {
  id: number
  customerName: string
  customerPhone: string
  planName: string
  addons: { name: string; price: string }[]
  total: string
  templateName: string
  eventType: string
  eventDate: string
  status: string
  adminUrl: string
}

export interface OrdersResponse {
  status: string
  statusChoices: Choice[]
  results: OrderRow[]
}

export interface InvitationRow {
  id: number
  title: string
  slug: string
  customerId: number
  customerName: string
  templateName: string
  status: string
  guests: number
  rsvps: number
  views: number
  createdAt: string | null
  createdLabel: string
  createdTitle: string
  url: string
  clientUrl: string
  venueUrl: string
  editorUrl: string
}

export interface InvitationFilters {
  q: string
  status: string
  template: string
}

export interface InvitationsResponse {
  filters: InvitationFilters
  statusChoices: Choice[]
  templateChoices: { id: number; name: string }[]
  results: InvitationRow[]
}

export interface InvitationOptions {
  templates: { id: number; name: string; cover: string | null; isActive: boolean }[]
  plans: { id: number; name: string; price: string }[]
  customers: { id: number; name: string; phone: string }[]
  eventTypes: string[]
}

export interface InvitationCreateBody {
  templateId: string
  planId: string
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  nameOne: string
  nameTwo: string
  eventType: string
}

export interface InvitationCustomerBody {
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
}

export interface TemplateRow {
  id: number
  slug: string
  name: string
  category: string
  categoryLabel: string
  source: string
  sourceLabel: string
  blocks: number
  uses: number
  isActive: boolean
  cover: string | null
  editorUrl: string
  adminUrl: string
  previewUrl: string
}

export interface TemplatesResponse {
  categories: Choice[]
  results: TemplateRow[]
}

export interface TemplateImportResult {
  id: number
  name: string
  blocks: number
  chars: number
  tracks: number
  scripts: number
  thinContent: boolean
}

export interface FontRow {
  id: number
  name: string
  nameEn: string
  family: string
  weight: number
  style: string
  styleLabel: string
  url: string
  isActive: boolean
}

/** خطة/نتيجة مسح المقطوعات المكررة (‎POST /dashboard/music/dedupe/‎). */
export interface DedupeResult {
  dryRun: boolean
  removeCount: number
  keepCount: number
  repointedDocs: number
  freedBytes: number
  groups: { name: string; keepId: number; removeCount: number }[]
}

export interface TrackRow {
  id: number
  name: string
  note: string
  url: string
  order: number
  isActive: boolean
}

export interface ClipRow {
  id: number
  name: string
  note: string
  url: string
  posterUrl: string
  secondsLabel: string
  order: number
  isActive: boolean
}

export interface PlanRow {
  id: number
  name: string
  price: string
  oldPrice: string
  features: string[]
  isFeatured: boolean
  isActive: boolean
  adminUrl: string
}

export interface AddonRow {
  id: number
  name: string
  nameEn: string
  code: string
  price: string
  priceValue: string
  description: string
  plans: { id: number; name: string }[]
  planIds: number[]
  isActive: boolean
  sortOrder: number
}

export interface PlansResponse {
  addons: AddonRow[]
  plans: PlanRow[]
  planChoices: { id: number; name: string }[]
  featureKeys: string[]
}

export interface AddonBody {
  name: string
  nameEn: string
  code: string
  price: string
  description: string
  plans: number[]
  isActive: boolean
  sortOrder: number
}

export interface PlanQuickBody {
  name: string
  price: string
  oldPrice: string
  isActive: boolean
}

export interface SiteValues {
  plansPublic: boolean
  homeTemplatesPerRow: number
  ordersEnabled: boolean
  whatsappEnabled: boolean
  whatsappNumber: string
  whatsappFloatEnabled: boolean
  whatsappCtaMessage: string
  previewCtaEnabled: boolean
  previewCtaText: string
  whatsappMessage: string
  facebookEnabled: boolean
  facebookUrl: string
  instagramEnabled: boolean
  instagramUrl: string
}

export interface SiteResponse {
  values: SiteValues
  state: {
    previewCtaEnabled: boolean
    previewCtaReady: boolean
    whatsappNumber: string
    facebookLinked: boolean
    instagramLinked: boolean
    ordersEnabled: boolean
    whatsappFloatEnabled: boolean
    whatsappFloatReady: boolean
  }
  sample: { name: string; previewUrl: string } | null
}
