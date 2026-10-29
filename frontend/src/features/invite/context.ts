import { createContext, useContext } from 'react'

import type { T } from './strings'
import type { InviteLang } from './types'

export interface InviteContextValue {
  lang: InviteLang
  t: T
  /** عرض الدعوة المرجعي للمقاسات المرنة */
  maxWidth: number
  /** معاينة قالب: مفيش دعوة حقيقية ورا الفورم */
  demo: boolean
  /** فيه شاشة افتتاحية مستنية فتح الدعوة (بتتحكم في الصوت والموسيقى) */
  hasIntro: boolean
}

export const InviteContext = createContext<InviteContextValue>({
  lang: 'ar',
  t: (key) => key,
  maxWidth: 0,
  demo: false,
  hasIntro: false,
})

export const useInvite = () => useContext(InviteContext)
