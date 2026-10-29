import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useTheme } from '@/lib/theme'

import { startAutosave } from './autosave'
import { IntroButton } from './frame/IntroButton'
import { OverlayButtons } from './frame/OverlayButtons'
import { PreviewPane } from './frame/PreviewPane'
import { BlocksPanel } from './panels/BlocksPanel'
import { DataPanel } from './panels/DataPanel'
import { InspectorPanel } from './panels/InspectorPanel'
import { SettingsPanel } from './panels/SettingsPanel'
import { ThemePanel } from './panels/ThemePanel'
import { TranslationPanel } from './panels/TranslationPanel'
import { SaveTemplateButton } from './SaveTemplateDialog'
import { useEditorShortcuts, useSaveFeedback, useSaveNow } from './shortcuts'
import { useEditor, type Tab } from './store'
import type { Device, EditorSchema } from './types'
import './fields'
import './styles/editor.css'
import './styles/settings.css'

const DEVICES: Device[] = ['mobile', 'tablet', 'desktop']

function SaveState() {
  const { t } = useTranslation()
  const status = useEditor((s) => s.saveStatus)
  const savedAt = useEditor((s) => s.savedAt)
  const label =
    status === 'saved' && savedAt ? t('editor.status.savedAt', { time: savedAt }) : t(`editor.status.${status}`)
  return <span className={`ed-save-state is-${status}`}>{label}</span>
}

export function EditorShell({ schema }: { schema: EditorSchema }) {
  const { t } = useTranslation()
  const title = useEditor((s) => s.title)
  const mode = useEditor((s) => s.mode)
  const meta = useEditor((s) => s.meta)
  const device = useEditor((s) => s.device)
  const setDevice = useEditor((s) => s.setDevice)
  const tab = useEditor((s) => s.tab)
  const setTab = useEditor((s) => s.setTab)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.history.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const blockCount = useEditor((s) => s.doc.blocks.length)
  const saving = useEditor((s) => s.saveStatus === 'saving')
  const toggleTheme = useTheme((s) => s.toggle)
  const [moreOpen, setMoreOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  const saveNow = useSaveNow()
  const onFrameKey = useEditorShortcuts()
  useSaveFeedback()
  useEffect(() => startAutosave(), [])
  useEffect(() => {
    document.title = `${t('editor.title')} — ${title}`
  }, [t, title])
  useEffect(() => {
    if (!moreOpen) return
    const close = () => setMoreOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [moreOpen])

  const tabs: Tab[] = mode === 'invitation' ? ['blocks', 'inspector', 'theme', 'data', 'i18n', 'settings'] : ['blocks', 'inspector', 'theme', 'i18n', 'settings']

  return (
    <div className="ed-root ed">
      <header className="ed-top">
        <div className="ed-top-group">
          <Link className="ed-brand" to={meta?.backUrl || '/dashboard'} title={t('editor.top.back')}>
            <span className="ed-brand-logo" aria-hidden="true" />
            <span className="ed-brand-txt">{t('editor.title')}</span>
          </Link>
        </div>
        <div className="ed-top-group ed-top-group--grow">
          <span className="ed-title">
            <strong>{title}</strong>
            {meta?.templateName ? ` · ${meta.templateName}` : ''}
            {mode === 'invitation' && meta?.planName ? ` · ${meta.planName}` : ''}
          </span>
        </div>
        <div className="ed-top-group">
          <button type="button" className="ed-btn ed-btn--icon ed-theme" title={t('editor.top.theme')} onClick={toggleTheme}>
            <svg className="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
            </svg>
            <svg className="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.9 6.9 0 0 0 10.8 10.8Z" />
            </svg>
          </button>
          <button type="button" className="ed-btn ed-btn--icon" title={t('editor.top.undo')} disabled={!canUndo} onClick={undo}>
            ↶
          </button>
          <button type="button" className="ed-btn ed-btn--icon" title={t('editor.top.redo')} disabled={!canRedo} onClick={redo}>
            ↷
          </button>
        </div>
        <div className="ed-seg" role="group" aria-label={t('editor.device.label')}>
          {DEVICES.map((d) => (
            <button key={d} type="button" className={device === d ? 'is-active' : undefined} onClick={() => setDevice(d)}>
              {t(`editor.device.${d}`)}
            </button>
          ))}
        </div>
        <div className="ed-top-group ed-top-actions">
          <SaveState />
          <div className="ed-more">
            <button
              type="button"
              className="ed-btn ed-btn--icon ed-more-btn"
              aria-expanded={moreOpen}
              title={t('editor.top.more')}
              onClick={(e) => {
                e.stopPropagation()
                setMoreOpen((open) => !open)
              }}
            >
              ⋯
            </button>
            <div className="ed-more-menu">
              {mode === 'invitation' && <SaveTemplateButton />}
              {meta?.publicUrl && (
                <a className="ed-btn ed-btn--sm" href={meta.publicUrl} target="_blank" rel="noopener" title={t('editor.top.preview')}>
                  {t('editor.top.open')}
                </a>
              )}
            </div>
          </div>
          <button type="button" className="ed-btn ed-btn--primary" disabled={saving} onClick={() => void saveNow()}>
            {t('editor.top.save')}
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--icon ed-panel-toggle"
            aria-expanded={panelOpen}
            title={t('editor.top.panel')}
            onClick={() => setPanelOpen((open) => !open)}
          >
            ☰
          </button>
        </div>
      </header>

      <div className="ed-main">
        <main className="ed-canvas">
          <div className="ed-canvas-bar">
            <span>{t('editor.blocks.hint')}</span>
            <span className="ed-canvas-tools">
              <OverlayButtons />
              <IntroButton />
              <span>{blockCount}</span>
            </span>
          </div>
          <div className="ed-stage">
            <PreviewPane onKey={onFrameKey} />
          </div>
        </main>

        {panelOpen && <div className="ed-panel-scrim" onClick={() => setPanelOpen(false)} />}
        <aside className={`ed-panel${panelOpen ? ' is-open' : ''}`}>
          <nav className="ed-tabs" role="tablist">
            {tabs.map((name) => (
              <button key={name} type="button" role="tab" aria-selected={tab === name} className={tab === name ? 'is-active' : undefined} onClick={() => setTab(name)}>
                {t(`editor.tabs.${name}`)}
              </button>
            ))}
          </nav>
          <div className="ed-tabpanes">
            <section className="ed-tabpane is-active" role="tabpanel">
              {tab === 'blocks' && <BlocksPanel schema={schema} />}
              {tab === 'inspector' && <InspectorPanel schema={schema} />}
              {tab === 'theme' && <ThemePanel schema={schema} />}
              {tab === 'data' && <DataPanel />}
              {tab === 'settings' && <SettingsPanel schema={schema} />}
              {tab === 'i18n' && <TranslationPanel />}
            </section>
          </div>
        </aside>
      </div>
    </div>
  )
}
