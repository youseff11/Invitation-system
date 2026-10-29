import { create } from 'zustand'

/**
 * زراير «الافتتاحية» و«تخطّي الافتتاحية» في شريط المعاينة بيزوّدوا العدّادات، و‎PreviewPane‎ بيبعت للإطار.
 * ‎visible‎ جاية من الإطار: الافتتاحية مغطّية المعاينة دلوقتي (زرار التخطّي بيظهر وقتها بس).
 * منفصلة عن ستور المحرر: دي أوامر لحظية للمعاينة مش جزء من حالة المستند.
 */
interface IntroBus {
  count: number
  show: () => void
  skipCount: number
  skip: () => void
  visible: boolean
  setVisible: (visible: boolean) => void
}

export const useIntroBus = create<IntroBus>()((set) => ({
  count: 0,
  show: () => set((state) => ({ count: state.count + 1 })),
  skipCount: 0,
  skip: () => set((state) => ({ skipCount: state.skipCount + 1 })),
  visible: false,
  setVisible: (visible) => set({ visible }),
}))
