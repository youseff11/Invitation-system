import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api/client'
import { useToast } from '@/features/dashboard/ui/Toast'

interface SiteIcon {
  custom: boolean
  /** رابط الأيقونة المرفوعة، أو فاضي لو الموقع على الأيقونة الافتراضية */
  url: string
}

const DEFAULT_ICON = '/static/images/logo.jpeg'
const KEY = ['data', 'site-icon'] as const

/** الأيقونة الجديدة تبان في تبويب المتصفح فوراً من غير ريفرش (الصفحات التانية بتاخدها من السيرفر). */
function syncHeadIcons(url: string) {
  const href = url || `/favicon.ico?r=${Date.now()}`
  document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((link) => {
    link.href = href
  })
}

/** «تغيير أيقونة الموقع»: رفع صورة بتبقى أيقونة التبويب (favicon) في الموقع كله، واستعادة الافتراضية. */
export function SiteIconControl() {
  const { t } = useTranslation()
  const toast = useToast()
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api<SiteIcon>('/data/site-icon/') })

  const done = (state: SiteIcon, message: string) => {
    client.setQueryData(KEY, state)
    syncHeadIcons(state.url)
    toast.success(message)
  }
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.set('file', file)
      return api<SiteIcon>('/data/site-icon/', { method: 'POST', body: form })
    },
    onSuccess: (state) => done(state, t('dataadmin.siteIcon.changed')),
    onError: toast.fail,
  })
  const reset = useMutation({
    mutationFn: () => api<SiteIcon>('/data/site-icon/', { method: 'DELETE' }),
    onSuccess: (state) => done(state, t('dataadmin.siteIcon.restored')),
    onError: toast.fail,
  })
  const busy = upload.isPending || reset.isPending

  return (
    <div className="da-icon-control">
      <img className="da-icon-preview" src={data?.url || DEFAULT_ICON} alt="" width={40} height={40} />
      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => input.current?.click()}>
        {upload.isPending ? t('dataadmin.siteIcon.uploading') : t('dataadmin.siteIcon.change')}
      </button>
      {data?.custom && (
        <button type="button" className="da-icon-reset" disabled={busy} onClick={() => reset.mutate()}>
          {t('dataadmin.siteIcon.restore')}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon"
        hidden
        data-testid="site-icon-file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = '' // نفس الملف مرة تانية يشتغل
          if (file) upload.mutate(file)
        }}
      />
      <span className="da-icon-hint">{t('dataadmin.siteIcon.hint')}</span>
    </div>
  )
}
