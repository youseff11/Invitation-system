import { create } from 'zustand'

export type Theme = 'light' | 'dark'

// نفس مفتاح الموقع القديم وسكربت الـshell — الاختيار بيمشي بين النسختين
const STORAGE_KEY = 'leila-theme'

function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* وضع خاص أو تخزين ممنوع — الاختيار بيفضل للجلسة بس */
  }
}

interface ThemeState {
  theme: Theme
  toggle: () => void
  set: (theme: Theme) => void
}

// القيمة الأولى بيحطها سكربت الـshell قبل أول رسم؛ هنا بنقراها بس
export const useTheme = create<ThemeState>((set, get) => ({
  theme: currentTheme(),
  toggle: () => get().set(get().theme === 'dark' ? 'light' : 'dark'),
  set: (theme) => {
    apply(theme)
    set({ theme })
  },
}))
