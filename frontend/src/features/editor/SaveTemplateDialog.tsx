import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/api/client'

import { postSaveTemplate } from './api'
import { errorText } from './assets/errors'
import { Modal } from './assets/Modal'
import { useEditor } from './store'
import { useEditorUi } from './ui'

/**
 * «حفظ كقالب»: يحوّل التصميم الحالي (حتى غير المحفوظ) لقالب جديد في المكتبة.
 * الدعوة نفسها ما بتتغيرش، والسيرفر هو اللي بيفرّغ البيانات الشخصية ويحسب الميزات المطلوبة.
 */
export function SaveTemplateButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="ed-btn ed-btn--sm" onClick={() => setOpen(true)}>
        {t('editor.saveTemplate.open')}
      </button>
      {open && <SaveTemplateDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function SaveTemplateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const categories = useEditor((s) => s.lib.categories)
  const title = useEditor((s) => s.title)
  const [name, setName] = useState(title)
  const [slug, setSlug] = useState('')
  const [category, setCategory] = useState(categories.some((c) => c.value === 'wedding') ? 'wedding' : (categories[0]?.value ?? 'wedding'))
  const [collection, setCollection] = useState('Premium')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [nameError, setNameError] = useState('')

  const close = () => !busy && onClose()
  const submit = async () => {
    const state = useEditor.getState()
    setBusy(true)
    setNameError('')
    try {
      const saved = await postSaveTemplate(state.id, state.doc, { name, slug, category, collection, description, isActive })
      ui.toast(t('editor.saveTemplate.saved', { name: saved.name }), 'ok')
      onClose()
    } catch (error) {
      const fieldError = error instanceof ApiError ? error.fields?.name : ''
      if (fieldError) setNameError(fieldError)
      else ui.toast(errorText(error, t, 'editor.saveTemplate.failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal label={t('editor.saveTemplate.title')} onClose={close}>
      <h3>{t('editor.saveTemplate.title')}</h3>
      <p className="ed-hint">{t('editor.saveTemplate.hint')}</p>
      <form
        className="ed-form-stack"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="ed-field">
          <label htmlFor="ed-tpl-name">
            <span>{t('editor.saveTemplate.name')}</span>
          </label>
          <input id="ed-tpl-name" className="ed-input" type="text" maxLength={120} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          {nameError && <small role="alert">{nameError}</small>}
        </div>
        <div className="ed-field">
          <label htmlFor="ed-tpl-slug">
            <span>{t('editor.saveTemplate.slug')}</span>
          </label>
          <input id="ed-tpl-slug" className="ed-input" type="text" dir="ltr" maxLength={80} value={slug} onChange={(e) => setSlug(e.target.value)} />
          <small>{t('editor.saveTemplate.slugHint')}</small>
        </div>
        <div className="ed-field">
          <label htmlFor="ed-tpl-category">
            <span>{t('editor.saveTemplate.category')}</span>
          </label>
          <select id="ed-tpl-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="ed-field">
          <label htmlFor="ed-tpl-collection">
            <span>{t('editor.saveTemplate.collection')}</span>
          </label>
          <input id="ed-tpl-collection" className="ed-input" type="text" maxLength={40} value={collection} onChange={(e) => setCollection(e.target.value)} />
        </div>
        <div className="ed-field">
          <label htmlFor="ed-tpl-description">
            <span>{t('editor.saveTemplate.description')}</span>
          </label>
          <textarea id="ed-tpl-description" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <label className="ed-toggle" htmlFor="ed-tpl-active">
          <span>{t('editor.saveTemplate.active')}</span>
          <input id="ed-tpl-active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span className="ed-switch" />
        </label>
        <div className="ed-modal-actions">
          <button type="button" className="ed-btn" disabled={busy} onClick={close}>
            {t('editorAssets.cancel')}
          </button>
          <button type="submit" className="ed-btn ed-btn--primary" disabled={busy || name.trim().length < 2}>
            {t('editor.saveTemplate.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
