/** شكل حمولة عارض الدعوة — بيتطابق مع ‎system/api/invite_render.py‎ و‎invite.py‎. */

export type InviteLang = 'ar' | 'en'

export interface BlockAttrs {
  id: string
  className: string
  /** نص CSS جاهز (متغيّرات القسم) — بيتحوّل لـobject في ‎parseStyle‎ */
  style: string
}

export interface OrnamentRef {
  variant: string
  size?: number
}

export interface ButtonItem {
  label: string
  style: string
  action: string
  icon: string
  href: string
  external: boolean
}

export interface SocialItem {
  name: 'whatsapp' | 'facebook' | 'instagram'
  href: string
  color: string
}

export interface WishItem {
  name: string
  message: string
}

export interface RsvpQuestion {
  index: number
  name: string
  label: string
  kind: 'choice' | 'text' | 'textarea'
  hint: string
  required: boolean
  multiple: boolean
  options: { label: string; checked: boolean }[]
  value: string
}

export interface RsvpExtras {
  action: string
  demo: boolean
  closed: boolean
  questions: RsvpQuestion[]
  wishes: WishItem[]
  guest: {
    name: string
    phone: string
    token: string
    maxCompanions: number
    answered: { status: string; companions: number; message: string } | null
  } | null
}

/** خصائص البلوك كما بتوصل — الأنواع مرنة لأن المستند نفسه مرن (القيمة ممكن تكون ناقصة). */
export type Props = Record<string, unknown>

export interface BlockData {
  id: string
  type: string
  attrs: BlockAttrs
  props: Props
  dividerTop: string
  dividerBottom: string
  /** عناصر «فوق القسم» — HTML متنقّى من السيرفر */
  overlays: string
  /** «كود متقدّم» — HTML متنقّى من السيرفر (ومعاه سكربتات القسم) */
  code: string
  rsvp?: RsvpExtras
  /** معاينة المحرر بس: القسم مخفي (بيظهر باهت) / خارج باقة العميل (بيتعلّم بتنبيه) */
  hidden?: boolean
  gated?: boolean
  locked?: boolean
  /** إزاحات العناصر اللي اتسحبت (المعاينة بس) */
  layout?: Record<string, { dx: number; dy: number }>
}

export interface IntroCode {
  css: string
  html: string
  js: string
}

export interface IntroData {
  video: string
  poster: string
  playMode: string
  audio: string
  playLabel: string
  seconds: number
  note: string
  text: string
  button: string
  style: string
  itemStyles: Record<string, string>
  guestName: string
  code: IntroCode | null
}

export interface RuntimeScript {
  src?: string
  code?: string
  type?: string
}

export interface HeadCss {
  font: string
  layout: string
  shared: string
  zero: string
}

export interface MusicConfig {
  url: string
  autoplay: boolean
  loop: boolean
  player: string
}

export interface ScrollConfig {
  enabled: boolean
  speed?: string
  delay?: number
  loop?: boolean
}

export interface PreviewCta {
  text: string
  template_name: string
  whatsapp: string
  facebook: string
}

export interface HeadInfo {
  title: string
  description: string
  image: { url: string; width: number; height: number }
  favicon: string
  canonical: string
}

export interface RenderPayload {
  kind: 'invitation' | 'template'
  slug: string
  lang: InviteLang
  dir: 'rtl' | 'ltr'
  hasAlt: boolean
  altLang: InviteLang
  baseLang: InviteLang
  maxWidth: number
  bodyStyle: string
  /** بيتبعت في ردّ الـAPI؛ في الـshell بيتطبع في الـ‎<head>‎ مباشرة */
  css?: HeadCss
  fontPreloads: string[]
  stage: { runtime: boolean; rootAttrs: Record<string, string>; full: boolean; pattern: string }
  showBranding: boolean
  intro: IntroData | null
  blocks: BlockData[]
  runtimeScripts: RuntimeScript[]
  runtimeIsSpa: boolean
  guest: { name: string; token: string } | null
  head: HeadInfo
  music: MusicConfig | null
  scroll: ScrollConfig
  cta: PreviewCta | null
  demo: boolean
  siteName: string
  siteUrl: string
}

export type Boot =
  | ({ mode: 'view' } & RenderPayload)
  | { mode: 'locked'; slug: string; siteName: string }
