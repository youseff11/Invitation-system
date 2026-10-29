import type { CSSProperties } from 'react'

import { useInvite } from '../context'
import { Lines } from '../Lines'
import { parseStyle, fluid, text } from '../style'
import { Icon, Ornament, SocialLink } from '../svg'
import type { BlockData, ButtonItem, SocialItem, WishItem } from '../types'
import { Frame, Tail } from './Frame'

/**
 * البلوكات «الثابتة»: كل واحد مطابق لقالبه في ‎templates/blocks/<type>.html‎
 * (نفس العناصر والكلاسات و‎data-slot/data-move/data-ts‎ لأن ‎layout_css‎ ومحرّك
 * تنسيق النص بيحصروا عليها). القيم المعقّدة (الأزرار، الروابط، النص المنسّق،
 * الـSVG) بتوصل جاهزة ومتنقّاة من السيرفر.
 */
const props = <T,>(block: BlockData) => block.props as T

const on = (v: unknown) => (Array.isArray(v) ? v.length > 0 : Boolean(v))

function CssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as unknown as CSSProperties
}

// ---------------------------------------------------------------- أزرار
function ButtonLink({ b }: { b: ButtonItem }) {
  return (
    <a
      className={`lb-btn lb-btn--${b.style}`}
      href={b.href}
      data-action={b.action}
      {...(b.external ? { target: '_blank', rel: 'noopener' } : {})}
    >
      {b.icon && <Icon name={b.icon} size={18} />}
      <span>{b.label}</span>
    </a>
  )
}

// ---------------------------------------------------------------- الهيرو
interface HeroProps {
  kicker?: string
  name_one?: string
  separator?: string
  name_two?: string
  names_layout?: string
  subtitle?: string
  date_text?: string
  show_scroll_hint?: boolean
  scroll_hint_text?: string
  name_font?: string
  name_size?: number
  name_size_mobile?: number
  name_spacing?: number
  buttons?: ButtonItem[]
}

export function Hero({ block }: { block: BlockData }) {
  const { maxWidth } = useInvite()
  const p = props<HeroProps>(block)
  const { attrs } = block
  const style: CSSProperties = {
    ...parseStyle(attrs.style),
    ...CssVars({
      '--name-size': fluid(p.name_size, { floor: p.name_size_mobile }),
      '--name-spacing': fluid(p.name_spacing, { ref: maxWidth }),
      ...(p.name_font ? { '--name-font': p.name_font } : {}),
    }),
  }
  const top = block.dividerTop
  const bottom = block.dividerBottom
  return (
    <section
      id={attrs.id}
      className={attrs.className}
      style={style}
      data-block={block.id}
      data-block-type="hero"
    >
      <div className="lb-hero-veil" />
      <div className="lb-inner lb-hero-inner">
        {on(p.kicker) && (
          <p className="lb-kicker" data-slot="kicker" data-move="kicker" data-ts="kicker">
            {p.kicker}
          </p>
        )}
        {top && top !== 'none' && <Ornament variant={top} size={46} slot="ornament_top" />}
        <h1 className={`lb-names lb-names--${text(p.names_layout)}`}>
          <span className="lb-name" data-slot="name_one" data-move="name_one" data-ts="name_one">
            {p.name_one}
          </span>
          {on(p.separator) && (
            <span className="lb-sep" data-slot="separator" data-move="separator" data-ts="separator">
              {p.separator}
            </span>
          )}
          {on(p.name_two) && (
            <span className="lb-name" data-slot="name_two" data-move="name_two" data-ts="name_two">
              {p.name_two}
            </span>
          )}
        </h1>
        {bottom && bottom !== 'none' && <Ornament variant={bottom} size={46} slot="ornament_bottom" />}
        {on(p.subtitle) && (
          <p className="lb-hero-sub" data-slot="subtitle" data-move="subtitle" data-ts="subtitle">
            {p.subtitle}
          </p>
        )}
        {on(p.date_text) && (
          <p className="lb-hero-date" data-slot="date_text" data-move="date_text" data-ts="date_text">
            {p.date_text}
          </p>
        )}
        {on(p.buttons) && (
          <div className="lb-btn-row" data-move="buttons">
            {p.buttons!.map((b, i) => (
              <ButtonLink key={i} b={b} />
            ))}
          </div>
        )}
      </div>
      {on(p.show_scroll_hint) && (
        <div className="lb-scroll-hint" data-move="scroll_hint">
          <span data-ts="scroll_hint_text">{p.scroll_hint_text}</span>
          <i />
        </div>
      )}
      <Tail block={block} />
    </section>
  )
}

// ---------------------------------------------------------------- نص
interface TextProps {
  eyebrow?: string
  heading?: string
  heading_font?: string
  heading_size?: number
  body_size?: number
  body_line_height?: number | string
  bodyHtml?: string
}

export function TextBlock({ block }: { block: BlockData }) {
  const { maxWidth } = useInvite()
  const p = props<TextProps>(block)
  const headingStyle: CSSProperties = { fontSize: fluid(p.heading_size, { ref: maxWidth }) }
  if (p.heading_font) headingStyle.fontFamily = p.heading_font
  const bodyStyle: CSSProperties = { fontSize: fluid(p.body_size, { ref: maxWidth }) }
  if (on(p.body_line_height)) bodyStyle.lineHeight = p.body_line_height
  return (
    <Frame block={block}>
      {on(p.eyebrow) && (
        <p className="lb-eyebrow" data-slot="eyebrow" data-move="eyebrow" data-ts="eyebrow">
          {p.eyebrow}
        </p>
      )}
      {on(p.heading) && (
        <h2
          className="lb-heading"
          data-slot="heading"
          data-move="heading"
          data-ts="heading"
          style={headingStyle}
        >
          {p.heading}
        </h2>
      )}
      {on(p.bodyHtml) && (
        <div
          className="lb-body"
          data-slot="body"
          data-move="body"
          data-ts="body"
          style={bodyStyle}
          dangerouslySetInnerHTML={{ __html: p.bodyHtml! }}
        />
      )}
    </Frame>
  )
}

// ---------------------------------------------------------------- اقتباس
interface QuoteProps {
  text?: string
  source?: string
  frame?: string
  quote_font?: string
  quote_size?: number
}

export function Quote({ block }: { block: BlockData }) {
  const { maxWidth } = useInvite()
  const p = props<QuoteProps>(block)
  const style: CSSProperties = { fontSize: fluid(p.quote_size, { ref: maxWidth }) }
  if (p.quote_font) style.fontFamily = p.quote_font
  return (
    <Frame block={block}>
      <blockquote className={`lb-quote lb-quote--${text(p.frame)}`} style={style}>
        <p data-slot="text" data-move="text" data-ts="text">
          {p.text}
        </p>
        {on(p.source) && (
          <cite data-slot="source" data-move="source" data-ts="source">
            {p.source}
          </cite>
        )}
      </blockquote>
    </Frame>
  )
}

// ---------------------------------------------------------------- أصحاب الدعوة
interface HostsProps {
  heading?: string
  entries?: { label?: string; name?: string }[]
  columns?: number
}

export function Hosts({ block }: { block: BlockData }) {
  const p = props<HostsProps>(block)
  return (
    <Frame block={block}>
      {on(p.heading) && (
        <h2 className="lb-heading" data-slot="heading" data-move="heading" data-ts="heading">
          {p.heading}
        </h2>
      )}
      <div data-move="hosts" className="lb-hosts" style={CssVars({ '--cols': text(p.columns) })}>
        {(p.entries ?? []).map((e, i) => (
          <div className="lb-host" key={i}>
            {on(e.label) && <span className="lb-host-label">{e.label}</span>}
            <strong className="lb-host-name">{e.name}</strong>
          </div>
        ))}
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------- التفاصيل
interface DetailsProps {
  heading?: string
  eyebrow?: string
  layout?: string
  columns?: number
  rows?: { icon?: string; label?: string; value?: string; hint?: string }[]
}

export function Details({ block }: { block: BlockData }) {
  const p = props<DetailsProps>(block)
  return (
    <Frame block={block}>
      {on(p.eyebrow) && (
        <p className="lb-eyebrow" data-ts="eyebrow">
          {p.eyebrow}
        </p>
      )}
      {on(p.heading) && (
        <h2 className="lb-heading" data-slot="heading" data-move="heading" data-ts="heading">
          {p.heading}
        </h2>
      )}
      <div
        data-move="details"
        className={`lb-details lb-details--${text(p.layout)}`}
        style={CssVars({ '--cols': text(p.columns) })}
      >
        {(p.rows ?? []).map((row, i) => (
          <div className="lb-detail" key={i}>
            {on(row.icon) && (
              <span className="lb-detail-icon">
                <Icon name={row.icon} size={26} />
              </span>
            )}
            {on(row.label) && <span className="lb-detail-label">{row.label}</span>}
            <strong className="lb-detail-value">{row.value}</strong>
            {on(row.hint) && <span className="lb-detail-hint">{row.hint}</span>}
          </div>
        ))}
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------- البرنامج
interface AgendaProps {
  heading?: string
  items?: { time?: string; title?: string; note?: string; icon?: string }[]
}

export function Agenda({ block }: { block: BlockData }) {
  const p = props<AgendaProps>(block)
  return (
    <Frame block={block}>
      {on(p.heading) && (
        <h2 className="lb-heading" data-slot="heading" data-move="heading" data-ts="heading">
          {p.heading}
        </h2>
      )}
      <ol data-move="agenda" className="lb-agenda">
        {(p.items ?? []).map((it, i) => (
          <li className="lb-agenda-item" key={i}>
            <span className="lb-agenda-time">{it.time}</span>
            <span className="lb-agenda-dot">{on(it.icon) && <Icon name={it.icon} size={16} />}</span>
            <span className="lb-agenda-body">
              <strong>{it.title}</strong>
              {on(it.note) && <em>{it.note}</em>}
            </span>
          </li>
        ))}
      </ol>
    </Frame>
  )
}

// ---------------------------------------------------------------- الموقع
interface LocationProps {
  heading?: string
  eyebrow?: string
  venue?: string
  address?: string
  show_map?: boolean
  map_embed_url?: string
  map_link?: string
  map_width?: number
  map_height?: number
  directions_label?: string
  notes?: string
}

export function Location({ block }: { block: BlockData }) {
  const { t } = useInvite()
  const p = props<LocationProps>(block)
  const mapStyle = CssVars({
    '--map-w': `${p.map_width || 100}%`,
    '--map-h': `${text(p.map_height)}px`,
  })
  return (
    <Frame block={block}>
      {on(p.eyebrow) && (
        <p className="lb-eyebrow" data-ts="eyebrow">
          {p.eyebrow}
        </p>
      )}
      {on(p.heading) && (
        <h2 className="lb-heading" data-slot="heading" data-move="heading" data-ts="heading">
          {p.heading}
        </h2>
      )}
      {on(p.venue) && (
        <p className="lb-venue" data-slot="venue" data-move="venue" data-ts="venue">
          {p.venue}
        </p>
      )}
      {on(p.address) && (
        <p className="lb-address" data-slot="address" data-move="address" data-ts="address">
          <Lines text={p.address} />
        </p>
      )}
      {on(p.show_map) && on(p.map_embed_url) ? (
        <div data-move="map" className="lb-map" style={mapStyle}>
          <iframe
            src={p.map_embed_url}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title={t('map.title')}
          />
        </div>
      ) : (
        on(p.show_map) && (
          <div className="lb-map lb-map--empty" style={mapStyle}>
            <Icon name="pin" size={34} />
            <span>{t('map.empty')}</span>
          </div>
        )
      )}
      {on(p.map_link) && (
        <a className="lb-btn lb-btn--solid" href={p.map_link} target="_blank" rel="noopener">
          <Icon name="pin" size={18} />
          <span data-ts="directions_label">{p.directions_label}</span>
        </a>
      )}
      {on(p.notes) && (
        <p className="lb-note" data-ts="notes">
          <Lines text={p.notes} />
        </p>
      )}
    </Frame>
  )
}

// ---------------------------------------------------------------- صورة
interface ImageProps {
  src?: string
  caption?: string
  frame?: string
  max_width?: number
  /** ٥–١٠٠ (٪) — الناقص أو ١٠٠ = معتمة */
  opacity?: number
}

export function ImageBlock({ block }: { block: BlockData }) {
  const { t } = useInvite()
  const p = props<ImageProps>(block)
  const opacity = Number(p.opacity)
  const faded = opacity >= 5 && opacity < 100 ? { opacity: opacity / 100 } : undefined
  return (
    <Frame block={block}>
      {on(p.src) ? (
        <figure
          data-move="image"
          className={`lb-figure lb-figure--${text(p.frame)}`}
          style={{ maxWidth: `${text(p.max_width)}px` }}
        >
          <img src={p.src} alt={p.caption || ''} loading="lazy" style={faded} />
          {on(p.caption) && <figcaption data-ts="caption">{p.caption}</figcaption>}
        </figure>
      ) : (
        <div className="lb-gempty">{t('empty.image')}</div>
      )}
    </Frame>
  )
}

// ---------------------------------------------------------------- فاصل ومسافة
export function Divider({ block }: { block: BlockData }) {
  const p = props<{ variant?: string; size?: number }>(block)
  return (
    <Frame block={block} ornaments={false}>
      <Ornament variant={p.variant} size={p.size} slot="ornament_top" />
    </Frame>
  )
}

export function Spacer({ block }: { block: BlockData }) {
  const { maxWidth } = useInvite()
  const p = props<{ height?: number }>(block)
  const { attrs } = block
  return (
    <>
      <div
        id={attrs.id}
        className={attrs.className}
        style={{ height: fluid(p.height, { ref: maxWidth }) }}
        data-block={block.id}
        data-block-type="spacer"
      />
      {/* القالب القديم بيحقن الكود بعد الـ‎<div>‎ مش جواه (مفيش ‎</section>‎) */}
      <Tail block={block} />
    </>
  )
}

// ---------------------------------------------------------------- أزرار
export function Buttons({ block }: { block: BlockData }) {
  const p = props<{ layout?: string; items?: ButtonItem[] }>(block)
  return (
    <Frame block={block}>
      <div data-move="buttons" className={`lb-btn-row lb-btn-row--${text(p.layout)}`}>
        {(p.items ?? []).map((b, i) => (
          <ButtonLink key={i} b={b} />
        ))}
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------- الدعاية
interface BrandingProps {
  logo?: string
  logo_width?: number
  text?: string
  icon_size?: number
  icon_gap?: number
  socials?: SocialItem[]
}

export function Branding({ block }: { block: BlockData }) {
  const p = props<BrandingProps>(block)
  return (
    <Frame block={block} innerClass="lb-inner lb-branding">
      {on(p.logo) && (
        <img
          className="lb-branding-logo"
          src={p.logo}
          alt=""
          loading="lazy"
          style={{ width: `${text(p.logo_width)}%` }}
        />
      )}
      {on(p.socials) && (
        <div className="lb-social-row" data-move="social" style={CssVars({ '--social-gap': `${text(p.icon_gap)}px` })}>
          {p.socials!.map((s) => (
            <SocialLink key={s.name} name={s.name} href={s.href} color={s.color} size={p.icon_size} />
          ))}
        </div>
      )}
      {on(p.text) && (
        <p className="lb-branding-text" data-slot="text" data-move="text" data-ts="text">
          <Lines text={p.text} />
        </p>
      )}
    </Frame>
  )
}

// ---------------------------------------------------------------- رسائل التهنئة
export function Wishes({ block }: { block: BlockData }) {
  const p = props<{ heading?: string; layout?: string; empty_text?: string; wishes?: WishItem[] }>(block)
  const wishes = p.wishes ?? []
  return (
    <Frame block={block}>
      {on(p.heading) && (
        <h2 className="lb-heading" data-slot="heading" data-move="heading" data-ts="heading">
          {p.heading}
        </h2>
      )}
      <div className={`lb-wishes lb-wishes--${text(p.layout)}`}>
        {wishes.length ? (
          wishes.map((w, i) => (
            <article className="lb-wish" key={i}>
              <p>{w.message}</p>
              <cite>{w.name}</cite>
            </article>
          ))
        ) : (
          <p className="lb-body lb-muted" data-ts="empty_text">
            {p.empty_text}
          </p>
        )}
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------- رمز QR
export function Qr({ block }: { block: BlockData }) {
  const { t } = useInvite()
  const p = props<{
    heading?: string
    size?: number
    show_link?: boolean
    note?: string
    qrSvg?: string
    publicUrl?: string
  }>(block)
  const svg = p.qrSvg || ''
  return (
    <Frame block={block}>
      {on(p.heading) && (
        <h2 className="lb-heading" data-slot="heading" data-move="heading" data-ts="heading">
          {p.heading}
        </h2>
      )}
      {svg ? (
        <div
          data-move="qr"
          className="lb-qr"
          style={CssVars({ '--qr-size': `${text(p.size)}px` })}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div data-move="qr" className="lb-qr" style={CssVars({ '--qr-size': `${text(p.size)}px` })}>
          <div className="lb-qr-empty">
            <Icon name="info" size={28} />
            <span>{t('empty.qr')}</span>
          </div>
        </div>
      )}
      {on(p.show_link) && on(p.publicUrl) && <p className="lb-qr-link">{p.publicUrl}</p>}
      {on(p.note) && (
        <p className="lb-note" data-ts="note">
          <Lines text={p.note} />
        </p>
      )}
    </Frame>
  )
}

// ---------------------------------------------------------------- قسم مستورد / كود حر
interface CustomProps {
  html?: string
  css?: string
  bgColor?: string
  countdown_date?: string
  countdown_dir?: string
}

/**
 * ‎custom_html‎: القسم المستورد (Tilda…) أو الـHTML الحر. الـHTML والستايل جايين
 * متنقّيين ومحصورين على القسم من السيرفر (‎safe_html‎ و‎safe_css‎) — ده السبب
 * الوحيد إنه HTML من السيرفر داخل component بدل عناصر React.
 */
export function CustomHtml({ block }: { block: BlockData }) {
  const p = props<CustomProps>(block)
  const dir = p.countdown_dir === 'rtl' || p.countdown_dir === 'ltr' ? p.countdown_dir : undefined
  return (
    <Frame block={block}>
      {on(p.css) && <style dangerouslySetInnerHTML={{ __html: p.css! }} />}
      <div
        className="lb-custom"
        ref={(el) => {
          // !important مش مدعوم في ‎style‎ object
          if (el && p.bgColor) el.style.setProperty('background-color', p.bgColor, 'important')
        }}
        data-lb-imported-countdown-date={p.countdown_date || undefined}
        data-cd-dir={dir}
        dangerouslySetInnerHTML={{ __html: p.html ?? '' }}
      />
    </Frame>
  )
}

