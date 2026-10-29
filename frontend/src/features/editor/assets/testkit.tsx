/** أدوات مشتركة لاختبارات مكتبة الأصول (C3) — مش بتتحمّل في التطبيق. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

import { EditorUiProvider } from '../ui'
import type { AssetRow, BlockSpec, Bootstrap, DocBlock, EditorSchema, FieldSpec } from '../types'

export const asset = (id: number, over: Partial<AssetRow> = {}): AssetRow => ({
  id,
  url: `/media/assets/2026/01/${String(id).padStart(12, '0')}/a${id}.webp`,
  thumb: `/media/assets/2026/01/${String(id).padStart(12, '0')}/a${id}-t.webp`,
  source: `/media/assets/2026/01/${String(id).padStart(12, '0')}/a${id}-src.png`,
  name: `a${id}.png`,
  kind: 'image',
  used: false,
  ...over,
})

export const block = (id: string, type = 'text', over: Partial<DocBlock> = {}): DocBlock => ({
  id,
  type,
  visible: true,
  locked: false,
  props: { heading: 'مرحباً' },
  style: {},
  ...over,
})

const field = (key: string, type: FieldSpec['type'], over: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  label: key,
  type,
  default: '',
  group: 'المحتوى',
  ...over,
})

export const textSpec: BlockSpec = {
  type: 'text',
  label: 'قسم نصي',
  icon: 'T',
  description: '',
  category: 'أساسي',
  feature: '',
  singleton: false,
  props: [field('heading', 'text', { label: 'العنوان' })],
  style: [],
}

export const heroSpec: BlockSpec = { ...textSpec, type: 'hero', label: 'الغلاف', singleton: true }

export const schema = {
  version: 1,
  blocks: { text: textSpec, hero: heroSpec },
  theme_fields: [],
  settings_fields: [],
  fonts: [],
  animations: [],
  dividers: [],
  layout_max: { x: 1000, y: 1000 },
} as EditorSchema

export const boot = (extra: Partial<Bootstrap> = {}): Bootstrap => ({
  mode: 'invitation',
  id: 7,
  title: 't',
  document: { version: 1, theme: {}, settings: {}, blocks: [block('a'), block('b')] },
  fields: null,
  features: [],
  assets: [],
  fonts: [],
  intros: [],
  videos: [],
  music: [],
  categories: [],
  meta: { slug: 's', status: 'draft', planName: '', templateName: '', publicUrl: '', clientFollowupUrl: '', backUrl: '' },
  ...extra,
})

export function mount(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EditorUiProvider>{node}</EditorUiProvider>
    </QueryClientProvider>,
  )
}

/** وعد بنحله بإيدينا — لاختبار حالات «لسه بيرفع». */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
