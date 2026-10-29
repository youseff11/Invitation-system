import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api/client'
import { useConfirm } from '@/features/dashboard/ui/ConfirmDialog'
import { useToast } from '@/features/dashboard/ui/Toast'

type Slot = 'light' | 'dark'

interface SiteLogo {
  light: boolean
  dark: boolean
  /** وقت آخر تعديل — بيتحط في رابط المعاينة عشان الصورة تتحدّث */
  version: number
}

interface ApplyResult {
  templates: number
  invitations: number
  blocks: number
}

const KEY = ['data', 'site-logo'] as const
const SLOTS: Slot[] = ['light', 'dark']
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

/**
 * «لوجو الموقع»: لوجو فاتح وغامق بيظهروا في النافبار (الرئيسية ولوحة التحكم والمحرر) وفي هذه الصفحة،
 * وزرار يعمّمه على قسم «الدعاية» في كل القوالب والدعوات (القسم بيفضل بعدها يتبع اللوجو أوتوماتيك).
 */
export function SiteLogoControl() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const client = useQueryClient()
  const inputs = useRef<Record<Slot, HTMLInputElement | null>>({ light: null, dark: null })
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api<SiteLogo>('/data/site-logo/') })

  /** اللوجو في الصفحة الحالية (الـCSS بيقرا ‎--site-logo-*‎) بيتجدّد من غير ريفرش: رابط جديد بإصدار التعديل. */
  const refreshPage = (state: SiteLogo) => {
    client.setQueryData(KEY, state)
    const bust = `?v=${state.version || Date.now()}`
    for (const slot of SLOTS) document.documentElement.style.setProperty(`--site-logo-${slot}`, `url("/site-logo/${slot}.png${bust}")`)
  }

  const upload = useMutation({
    mutationFn: ({ slot, file }: { slot: Slot; file: File }) => {
      const form = new FormData()
      form.set('slot', slot)
      form.set('file', file)
      return api<SiteLogo>('/data/site-logo/', { method: 'POST', body: form })
    },
    onSuccess: (state) => {
      refreshPage(state)
      toast.success(t('dataadmin.siteLogo.changed'))
    },
    onError: toast.fail,
  })
  const reset = useMutation({
    mutationFn: (slot: Slot) => api<SiteLogo>('/data/site-logo/', { method: 'DELETE', query: { slot } }),
    onSuccess: (state) => {
      refreshPage(state)
      toast.success(t('dataadmin.siteLogo.restored'))
    },
    onError: toast.fail,
  })
  const apply = useMutation({
    mutationFn: () => api<ApplyResult>('/data/site-logo/apply/', { method: 'POST' }),
    onSuccess: (result) => toast.success(t('dataadmin.siteLogo.applied', { templates: result.templates, invitations: result.invitations })),
    onError: toast.fail,
  })
  const busy = upload.isPending || reset.isPending || apply.isPending

  const applyAll = async () => {
    if (await confirm({ message: t('dataadmin.siteLogo.applyConfirm'), confirmLabel: t('dataadmin.siteLogo.apply') })) apply.mutate()
  }

  const version = data?.version ? `?v=${data.version}` : ''
  return (
    <div className="da-logo-control">
      <strong className="da-logo-title">{t('dataadmin.siteLogo.title')}</strong>
      <div className="da-logo-slots">
        {SLOTS.map((slot) => (
          <div key={slot} className="da-logo-slot">
            <span className={`da-logo-preview da-logo-preview--${slot}`}>
              <img src={`/site-logo/${slot}.png${version}`} alt="" height={26} />
            </span>
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => inputs.current[slot]?.click()}>
              {t(`dataadmin.siteLogo.${slot}`)}
            </button>
            {data?.[slot] && (
              <button type="button" className="da-icon-reset" disabled={busy} onClick={() => reset.mutate(slot)}>
                {t('dataadmin.siteLogo.restore')}
              </button>
            )}
            <input
              ref={(node) => {
                inputs.current[slot] = node
              }}
              type="file"
              accept={ACCEPT}
              hidden
              data-testid={`site-logo-${slot}`}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) upload.mutate({ slot, file })
              }}
            />
          </div>
        ))}
      </div>
      <div className="da-logo-actions">
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void applyAll()}>
          {t('dataadmin.siteLogo.apply')}
        </button>
        <span className="da-icon-hint">{t('dataadmin.siteLogo.hint')}</span>
      </div>
    </div>
  )
}
