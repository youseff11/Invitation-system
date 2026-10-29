import type { BlockData, IntroData, RenderPayload } from './types'

/** حمولات صغيرة للاختبارات — نفس شكل ‎invite_render.build_payload‎. */
export function block(type: string, props: Record<string, unknown> = {}, extra: Partial<BlockData> = {}): BlockData {
  return {
    id: `${type}-1`,
    type,
    attrs: { id: `${type}-1`, className: `lb lb--${type} lb--w-normal`, style: '--block-pt:80px;--block-align:center' },
    props,
    dividerTop: '',
    dividerBottom: '',
    overlays: '',
    code: '',
    ...extra,
  }
}

export function intro(overrides: Partial<IntroData> = {}): IntroData {
  return {
    video: '',
    poster: '',
    playMode: 'autoplay',
    audio: 'silent',
    playLabel: '',
    seconds: 0,
    note: '',
    text: 'تشرّفنا بدعوتكم',
    button: 'افتح الدعوة',
    style: '',
    itemStyles: {},
    guestName: '',
    code: null,
    ...overrides,
  }
}

export function payload(overrides: Partial<RenderPayload> = {}): RenderPayload {
  return {
    kind: 'invitation',
    slug: 'demo',
    lang: 'ar',
    dir: 'rtl',
    hasAlt: false,
    altLang: 'en',
    baseLang: 'ar',
    maxWidth: 760,
    bodyStyle: '--bg:#fff',
    fontPreloads: [],
    stage: { runtime: false, rootAttrs: {}, full: false, pattern: '' },
    showBranding: true,
    intro: null,
    blocks: [],
    runtimeScripts: [],
    runtimeIsSpa: false,
    guest: null,
    head: { title: 'ليلى و أحمد', description: 'زفاف', image: { url: '', width: 0, height: 0 }, favicon: '', canonical: '' },
    music: null,
    scroll: { enabled: false },
    cta: null,
    demo: false,
    siteName: 'فرحة',
    siteUrl: 'http://x/',
    ...overrides,
  }
}

export function rsvpBlock(props: Record<string, unknown> = {}, rsvp: Partial<NonNullable<BlockData['rsvp']>> = {}): BlockData {
  return block(
    'rsvp',
    {
      heading: 'هل ستشرفوننا؟',
      name_label: 'الاسم',
      ask_phone: true,
      phone_label: 'رقم الهاتف',
      ask_companions: true,
      max_companions: 3,
      ask_message: true,
      message_label: 'كلمة',
      attending_label: 'سأحضر',
      declined_label: 'أعتذر',
      submit_label: 'إرسال التأكيد',
      sent_label: 'تم الإرسال ✓',
      success_message: 'شكراً لكم',
      closed_message: 'انتهى الموعد',
      ...props,
    },
    {
      attrs: { id: 'rsvp', className: 'lb lb--rsvp', style: '' },
      rsvp: {
        action: '/api/v1/invitations/demo/rsvp/',
        demo: false,
        closed: false,
        questions: [],
        wishes: [],
        guest: null,
        ...rsvp,
      },
    },
  )
}
