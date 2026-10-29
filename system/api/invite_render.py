"""حمولة JSON لعارض الدعوة (React) — نفس مستند الدعوة اللي بيرسمه ‎renderer.py‎.

السيرفر هو مصدر الحقيقة للمنطق: بنستورد من ‎renderer‎ كل اللي بيحسبه (الثيم،
تنسيق النصوص، الإزاحات، الترجمة، تعويض البيانات، رسائل التهنئة، أسئلة الـRSVP،
رابط الخريطة والتقويم) ونرجّعه JSON بدل HTML. الواجهة (React) بترسم البلوكات
من الحمولة دي.

اللي بيفضل HTML من السيرفر — وكله **متنقّى هنا** قبل ما يوصل للمتصفح (مفيش
تنقية في الواجهة):

* ‎custom_html‎: ‎html‎ (‎safe_html‎) وستايله محصور على القسم (‎safe_css‎).
* ‎text.bodyHtml‎: نص منسّق (‎safe_html‎).
* ‎code‎ و‎overlays‎: «كود متقدّم» والعناصر فوق القسم، من نفس قوالب
  ‎_section_code.html‎ و‎_overlay_item.html‎ (فلاتر حصر وأمان جاهزة فيها).
* ‎qr.qrSvg‎: SVG مولّد على السيرفر.

مرآة حلقة ‎renderer.render_document‎ (الجزء اللي بيلف على البلوكات) موجودة هنا
بدل ‎render_to_string‎ لكل بلوك. الموقع القديم هيتحذف، فالنسخة دي هي اللي
هتفضل؛ ومفيش تعديل في ‎renderer.py‎ عن قصد.
"""

from __future__ import annotations

import hashlib
import json
import re

from django.conf import settings as dj_settings
from django.core.cache import cache
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils import timezone

from .. import blocks as blocks_engine
from .. import renderer as R
from .. import tildacss
from ..templatetags import invite as tags

# يتزوّد مع أي تغيير في شكل الحمولة أو في طريقة العرض (كاش معاينة القالب)
PAYLOAD_REVISION = "2026-10-23-react-v1"

# ما يوصل للواجهة من خصائص كل بلوك. أي حاجة برّه القوائم دي (النص الخام،
# الستايل الحر، الكود) بتتعامل لوحدها تحت.
_PROP_KEYS: dict[str, tuple[str, ...]] = {
    "hero": ("kicker", "name_one", "separator", "name_two", "names_layout",
             "subtitle", "date_text", "show_scroll_hint", "scroll_hint_text",
             "height", "name_font", "name_size", "name_size_mobile",
             "name_spacing"),
    "text": ("eyebrow", "heading", "heading_font", "heading_size", "body_size",
             "body_line_height"),
    "quote": ("text", "source", "frame", "quote_font", "quote_size"),
    "hosts": ("heading", "entries", "columns"),
    "countdown": ("heading", "eyebrow", "label_days", "label_hours",
                  "label_minutes", "label_seconds", "show_seconds",
                  "finished_text", "variant", "countdown_dir", "number_size"),
    "details": ("heading", "eyebrow", "rows", "layout", "columns"),
    "agenda": ("heading", "items"),
    "location": ("heading", "eyebrow", "venue", "address", "show_map",
                 "map_embed_url", "map_link", "map_width",
                 "map_height", "directions_label", "notes"),
    "gallery": ("heading", "images", "layout", "columns", "gap",
                "image_radius", "aspect", "lightbox"),
    "image": ("src", "caption", "frame", "max_width", "opacity"),
    "video": ("url", "poster", "heading", "aspect", "autoplay", "sound", "loop"),
    "rsvp": ("heading", "eyebrow", "intro", "name_label", "phone_label",
             "companions_label", "message_label", "status_label",
             "attending_label", "declined_label", "maybe_label", "submit_label",
             "sent_label", "success_message", "wishes_heading", "wishes_empty",
             "closed_message", "ask_status", "ask_phone", "phone_required",
             "ask_companions", "max_companions", "ask_message", "show_maybe",
             "show_wishes"),
    "wishes": ("heading", "layout", "empty_text"),
    "qr": ("heading", "size", "show_link", "note"),
    "share": ("heading", "show_copy", "copy_label", "show_whatsapp",
              "whatsapp_label", "show_native", "show_calendar",
              "calendar_label"),
    "divider": ("variant", "size"),
    "spacer": ("height",),
    "buttons": ("layout",),
    "branding": ("logo", "logo_width", "text", "icon_size", "icon_gap"),
    "custom_html": ("countdown_date", "countdown_dir"),
}

_EXTERNAL_ACTIONS = {"link", "map", "calendar"}
_SOCIAL_HREF_RE = re.compile(r"^(?:https?://|mailto:|tel:)[^\s\"<>]{1,600}$", re.I)
_SOCIAL_COLOR_RE = re.compile(r"#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)")
_SOCIALS = ("whatsapp", "facebook", "instagram")
_SAFE_ICON = set(tags._ICONS)  # noqa: SLF001 — قايمة الأيقونات المعروفة
_DATA_ATTR = re.compile(r"data-[a-zA-Z0-9_-]{1,64}")


# ---------------------------------------------------------------- أدوات صغيرة
def _pick(props: dict, keys) -> dict:
    return {key: props.get(key) for key in keys if key in props}


def _buttons(items, data: dict) -> list[dict]:
    """أزرار البلوك جاهزة: الرابط والهدف محسوبين زي ‎button_href‎ بالظبط."""
    out = []
    for item in items or []:
        if not isinstance(item, dict) or not item.get("label"):
            continue
        action = item.get("action")
        out.append({
            "label": item.get("label"),
            "style": item.get("style") or "",
            "action": action or "",
            "icon": item.get("icon") if item.get("icon") in _SAFE_ICON else "",
            "href": str(tags.button_href(action, item.get("target"), data)),
            "external": action in _EXTERNAL_ACTIONS,
        })
    return out


def _socials(props: dict) -> list[dict]:
    """أيقونات السوشيال بعد فحصها بنفس شروط ‎social_link‎."""
    out = []
    for name in _SOCIALS:
        if not props.get(f"show_{name}"):
            continue
        href = str(props.get(f"{name}_url") or "").strip()
        hue = str(props.get(f"{name}_color") or "").strip()
        out.append({
            "name": name,
            "href": href if _SOCIAL_HREF_RE.match(href) else "",
            "color": hue if _SOCIAL_COLOR_RE.fullmatch(hue) else "currentColor",
        })
    return out


def _wishes(rows) -> list[dict]:
    return [{"message": w.message, "name": w.name} for w in rows]


def _rsvp_extras(ctx: dict, extras: dict, invitation, guest, editable) -> dict:
    guest_answered = extras.get("guest_answered")
    payload = {
        "action": (reverse("api_rsvp", kwargs={"slug": invitation.slug})
                   if invitation is not None and not editable else ""),
        "demo": bool(extras.get("rsvp_demo")),
        "closed": bool(extras.get("rsvp_closed")),
        "questions": extras.get("rsvp_questions") or [],
        "wishes": _wishes(extras.get("rsvp_wishes") or []),
        "guest": None,
    }
    if guest is not None:
        payload["guest"] = {
            "name": guest.name,
            "phone": guest.phone or "",
            "token": guest.token,
            "maxCompanions": int(extras.get("guest_max_companions") or 0),
            "answered": ({
                "status": guest_answered.status,
                "companions": int(guest_answered.companions or 0),
                "message": guest_answered.message or "",
            } if guest_answered is not None else None),
        }
    return payload


def _countdown_iso(resolved_props: dict, default_iso: str) -> str:
    picked = str(resolved_props.get("countdown_date") or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", picked):
        return picked
    return default_iso


# ---------------------------------------------------------------- الافتتاحية
def _intro_payload(s: dict, intro_style: str, item_styles: dict, guest) -> dict | None:
    if not s.get("intro_enabled"):
        return None

    code = None
    parts = tags.split_code(s.get("intro_code"))
    css = str(tags.safe_css(parts["css"], ".lb-intro")) if parts["css"] else ""
    html = str(tags.safe_html(parts["html"], 0)) if parts["html"].strip() else ""
    if css or html or parts["js"]:
        code = {"css": css, "html": html, "js": str(parts["js"])}

    return {
        "video": s.get("intro_video") or "",
        "poster": s.get("intro_poster") or "",
        "playMode": s.get("intro_play_mode") or "autoplay",
        "audio": s.get("intro_video_audio") or "silent",
        "playLabel": s.get("intro_play_label") or "",
        "seconds": s.get("intro_video_seconds") or 0,
        "note": s.get("intro_note") or "",
        "text": s.get("intro_text") or "",
        "button": s.get("intro_button") or "",
        "style": str(intro_style or ""),
        "itemStyles": {k: str(v) for k, v in item_styles.items()},
        "guestName": guest.name if guest is not None else "",
        "code": code,
    }


# ---------------------------------------------------------------- البلوكات
def _block_payload(block: dict, ctx: dict, extras: dict, *, invitation, guest,
                   editable: bool, data: dict) -> dict:
    btype = block["type"]
    props = ctx["props"]
    style = ctx["style"]
    classes = ctx["classes"]
    out_props = _pick(props, _PROP_KEYS.get(btype, ()))

    attrs = {"id": block["id"], "className": classes, "style": ctx["css"]}
    if ctx["hidden"]:
        # القسم المخفي بيوصل بس للمحرر (الضيف بيتخطّاه) — نفس كلاس القالب القديم
        attrs["className"] = f"{classes} lb--hidden"
    if btype == "rsvp":
        attrs["id"] = "rsvp"           # القالب القديم بيكتب id ثابت للتأكيد
    elif btype == "branding":
        attrs["className"] = f"{attrs['className']} lb--branding"
    elif btype == "hero":
        attrs["className"] = f"{attrs['className']} lb-hero--{props.get('height')}"
    elif btype == "spacer":
        attrs["style"] = ""

    record = {
        "id": block["id"],
        "type": btype,
        "attrs": attrs,
        "props": out_props,
        "dividerTop": style.get("divider_top") or "",
        "dividerBottom": style.get("divider_bottom") or "",
        "overlays": "",
        "code": "",
    }
    if editable:
        record["hidden"] = bool(ctx["hidden"])
        record["gated"] = bool(ctx["gated"])
        # المعاينة بتسحب النصوص: محتاجة الإزاحات الحالية وهل القسم مقفول
        record["locked"] = bool(block.get("locked"))
        record["layout"] = block.get("layout") or {}

    if btype == "hero":
        out_props["buttons"] = _buttons(props.get("buttons"), data)
    elif btype == "buttons":
        out_props["items"] = _buttons(props.get("items"), data)
    elif btype == "text":
        out_props["bodyHtml"] = str(tags.safe_html(props.get("body") or ""))
    elif btype == "countdown":
        out_props["iso"] = ctx["countdown_iso"]
    elif btype == "wishes":
        out_props["wishes"] = _wishes(extras.get("wishes") or [])
    elif btype == "qr":
        out_props["qrSvg"] = str(extras.get("qr_svg") or "")
        out_props["publicUrl"] = data.get("public_url") or ""
    elif btype == "share":
        allowed = ctx["allowed_features"]
        out_props["whatsappUrl"] = data.get("whatsapp_share") or ""
        out_props["calendarUrl"] = data.get("calendar_url") or ""
        out_props["whatsappAllowed"] = "whatsapp" in allowed
        out_props["calendarAllowed"] = "calendar" in allowed
    elif btype == "branding":
        out_props["socials"] = _socials(props)
    elif btype == "details":
        out_props["rows"] = [
            {key: row.get(key) for key in ("icon", "label", "value", "hint")}
            for row in props.get("rows") or [] if isinstance(row, dict)
        ]
    elif btype == "rsvp":
        record["rsvp"] = _rsvp_extras(ctx, extras, invitation, guest, editable)
    elif btype == "custom_html":
        out_props["html"] = str(tags.safe_html(props.get("html") or "", 0))
        css_raw = props.get("css")
        out_props["css"] = (
            str(tags.safe_css(css_raw, block["id"]))
            if css_raw and not ctx["css_shared"] else ""
        )
        out_props["bgColor"] = style.get("bg_color") or ""
    elif btype == "video":
        out_props["overlays"] = [
            render_to_string("blocks/_overlay_item.html", {
                "overlay": overlay, "index": index,
                "wrap_class": "lb-video-text", "is_video": True,
                "editable": editable,
            }) for index, overlay in enumerate(props.get("text_overlays") or [])
        ]

    if btype != "video" and props.get("text_overlays"):
        overlays = render_to_string(
            "blocks/_section_text_overlays.html", ctx, request=ctx["request"])
        record["overlays"] = overlays.strip()
    if str(props.get("code") or "").strip():
        code = render_to_string(
            "blocks/_section_code.html", ctx, request=ctx["request"])
        record["code"] = code.strip()
    return record


# ---------------------------------------------------------------- الحمولة
def build_payload(
    document: dict,
    *,
    invitation=None,
    request=None,
    allowed_features: set[str] | None = None,
    guest=None,
    lang: str = "",
    runtime_scripts: list[dict] | None = None,
    runtime_root_attrs: dict | None = None,
    editable: bool = False,
) -> tuple[dict, dict]:
    """يحوّل المستند لحمولة العرض. بيطابق ‎renderer.render_document‎ خطوة بخطوة.

    بيرجّع ‎(payload, private)‎: الأولى JSON عام، والتانية قيم داخلية للسيرفر
    (إعدادات المستند والبيانات) بتتبني منها الميتا ومشغّل الموسيقى.

    ‎editable=True‎ (معاينة المحرر): الأقسام المخفية بتفضل في الحمولة (‎hidden‎)
    والأقسام خارج الباقة بتتعلّم (‎gated‎)، والـRSVP والعناصر الفاضية بتتعرض
    كأنها في المحرر. الضيف دايماً ‎editable=False‎.
    """
    doc = blocks_engine.normalize_document(document)
    runtime_scripts = R._runtime_with_countdown_date(  # noqa: SLF001
        runtime_scripts, R._countdown_date_from_document(doc))

    base_lang = blocks_engine.base_language(doc)
    alt_lang = blocks_engine.alt_language(doc)
    has_alt = blocks_engine.has_translation(doc, alt_lang)
    lang = alt_lang if (lang == alt_lang and has_alt) else base_lang

    theme = doc["theme"]
    doc_settings = doc["settings"]
    data = R.build_data_context(invitation)

    if lang == alt_lang:
        doc = blocks_engine.apply_i18n(doc, alt_lang)
        theme = doc["theme"]
        doc_settings = doc["settings"]
        data = blocks_engine.apply_i18n_data(data, doc, alt_lang)
        theme["direction"] = "rtl" if lang == "ar" else "ltr"

    heading = theme.get(f"font_heading_{lang}")
    body = theme.get(f"font_body_{lang}")
    if heading:
        theme["font_heading"] = heading
    if body:
        theme["font_body"] = body

    if invitation is not None and request is not None:
        data["public_url"] = request.build_absolute_uri(invitation.get_absolute_url())

    title = " و ".join(n for n in [data["name_one"], data["name_two"]] if n)
    data["calendar_url"] = R._calendar_link(  # noqa: SLF001
        data, f"{data['event_type']} {title}")
    from urllib.parse import quote
    data["whatsapp_share"] = (
        f"https://wa.me/?text={quote((data['public_url'] or '') + ' ' + title)}"
        if data["public_url"] else ""
    )

    countdown_iso = ""
    if data.get("event_date"):
        ev = data["event_date"]
        countdown_iso = (timezone.localtime(ev) if timezone.is_aware(ev) else ev).isoformat()

    shared_css, shared_css_ids = R.shared_block_css(doc["blocks"])
    zero_css_parts: list[str] = []
    blocks_out: list[dict] = []

    for block in doc["blocks"]:
        spec = blocks_engine.BLOCK_REGISTRY.get(block["type"])
        if not spec:
            continue
        gated = bool(
            allowed_features is not None
            and spec["feature"]
            and spec["feature"] not in allowed_features
        )
        hidden = not block.get("visible", True)
        if hidden and not editable:
            continue

        resolved_props = R._resolve_props(block, data)  # noqa: SLF001
        if (block["type"] == "branding" and not editable
                and R._branding_empty(resolved_props, block.get("style") or {})):  # noqa: SLF001
            continue

        if runtime_scripts and isinstance(resolved_props.get("html"), str):
            resolved_props["html"] = R._unwrap_runtime_allrecords(  # noqa: SLF001
                resolved_props["html"])
            from ..templateimport import _align_embedded_map_element
            resolved_props["html"] = _align_embedded_map_element(resolved_props["html"])
        imported_html = isinstance(resolved_props.get("html"), str)
        if imported_html:
            zero_css_parts.append(tildacss.zero_block_css(
                str(block.get("id") or ""), resolved_props["html"]))
        zero_css_parts.append(tildacss.section_surface_css(
            str(block.get("id") or ""), block.get("style") or {},
            imported=imported_html))

        block_countdown_iso = countdown_iso
        if block["type"] == "countdown":
            block_countdown_iso = _countdown_iso(resolved_props, countdown_iso)

        ctx = {
            "block": block,
            "props": resolved_props,
            "style": block.get("style") or {},
            "theme": theme,
            "settings": doc_settings,
            "data": data,
            "invitation": invitation,
            "countdown_iso": block_countdown_iso,
            "editable": editable,
            "hidden": hidden,
            "gated": gated,
            "css": R.block_style_css(block.get("style") or {}, theme),
            "classes": R.block_classes(block, theme),
            "allowed_features": allowed_features or set(),
            "request": request,
            "has_alt": has_alt,
            "css_shared": str(block.get("id") or "") in shared_css_ids,
            "guest": guest,
            "lang": lang,
        }
        extras = R._block_extras(block, ctx, invitation, editable, guest)  # noqa: SLF001
        ctx.update(extras)
        blocks_out.append(_block_payload(
            block, ctx, extras, invitation=invitation, guest=guest,
            editable=editable, data=data))

    runtime_is_spa = False
    if runtime_scripts:
        imported = "".join(
            str((b.get("props") or {}).get("html") or "")
            for b in doc.get("blocks") or []
        )
        if re.search(
            r'''<(?:div|main)\b[^>]*\bid=["'](?:root|app|__next|__nuxt|___gatsby)["']''',
            imported, re.I,
        ):
            runtime_is_spa = True

    font_css = R._custom_font_css()  # noqa: SLF001
    # الخطوط اللي ممكن تتحمّل من جوّه كود القسم نفسه (زي ‎_font_preload_urls‎ القديمة)
    probe = " ".join(
        str(b["props"].get("html") or "") + b["code"] + b["overlays"]
        for b in blocks_out
    )
    layout = (
        R.layout_css(doc["blocks"]) + R.text_style_css(doc["blocks"], theme)
        + R.intro_layout_css(doc_settings)
        + (R.i18n_style_css(doc, lang, theme) if lang == alt_lang else "")
    )
    intro = _intro_payload(
        doc_settings, R.intro_css(doc_settings),
        {item: R.intro_item_css(doc_settings, item)
         for item in ("note", "guest_name", "text", "button", "play", "code")},
        guest)
    stage_runtime = bool(runtime_scripts)
    payload = {
        "lang": lang,
        "dir": theme.get("direction") or "rtl",
        "hasAlt": has_alt,
        "altLang": "ar" if lang == "en" else "en",
        "baseLang": base_lang,
        # عرض الدعوة المرجعي: المقاسات المرنة (clamp) بتتقاس عليه
        "maxWidth": theme.get("max_width") or 0,
        "bodyStyle": R.theme_css_vars(theme),
        "css": {
            "font": str(font_css),
            "layout": str(layout),
            "shared": str(shared_css),
            "zero": "".join(zero_css_parts),
        },
        "fontPreloads": R._font_preload_urls(font_css + probe),  # noqa: SLF001
        "stage": {
            "runtime": stage_runtime,
            "rootAttrs": ({
                str(k): str(v)[:300] for k, v in (runtime_root_attrs or {}).items()
                if _DATA_ATTR.fullmatch(str(k))
            } if stage_runtime else {}),
            "full": float(theme.get("max_width") or 0) >= 1100,
            "pattern": (theme.get("pattern")
                        if theme.get("pattern") not in (None, "", "none") else ""),
        },
        "showBranding": bool(doc_settings.get("show_branding")),
        "intro": intro,
        "blocks": blocks_out,
        "runtimeScripts": [
            item for item in (runtime_scripts or [])
            if isinstance(item, dict) and (item.get("src") or item.get("code"))
        ],
        "runtimeIsSpa": runtime_is_spa,
        "guest": ({"name": guest.name, "token": guest.token}
                  if guest is not None else None),
    }
    # قيم لازمة للـ‎<head>‎ والإعدادات بس — مابتتحطش في الـJSON العام
    private = {"settings": doc_settings, "data": data, "theme": theme}
    return payload, private


# ---------------------------------------------------------------- معاينة القالب (مخزّنة)
def template_payload(template, *, lang: str = "") -> tuple[dict, dict]:
    """حمولة معاينة القالب. مخزّنة بنفس فكرة ‎get_template_preview‎ بس بدون الكتابة
    على الموديل: القالب ممكن يوصل ٣ ميجا والعرض غالي."""
    signature = R._preview_signature(  # noqa: SLF001
        template.document, getattr(template, "runtime_scripts", []),
        getattr(template, "runtime_root_attrs", {}))
    key = "invite-tpl:%s:%s:%s:%s" % (
        PAYLOAD_REVISION, template.pk, lang or "-", signature[:32])
    cached = cache.get(key)
    if cached is not None:
        return cached
    payload, private = build_payload(
        template.document, invitation=None, request=None,
        allowed_features=None, lang=lang,
        runtime_scripts=getattr(template, "runtime_scripts", []),
        runtime_root_attrs=getattr(template, "runtime_root_attrs", {}),
    )
    private = {"settings": private["settings"], "data": {
        k: v for k, v in private["data"].items() if k != "event_date"}}
    pair = (payload, private)
    cache.set(key, pair, 60 * 60)
    return pair


def digest(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]
