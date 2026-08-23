"""محرّك العرض — يحوّل مستند البلوكات إلى HTML.

نفس المحرّك يُستخدم في ثلاثة أماكن، وهذا مقصود: ما تراه في المعاينة الحية
هو حرفياً ما سيراه الضيف، لأنه ناتج عن نفس الكود:

1. الصفحة العامة للدعوة  ``/i/<slug>/``
2. المعاينة داخل المحرر  ``/dashboard/.../preview/``
3. معاينة القالب في المعرض

كل بلوك له قالب في ``templates/blocks/<type>.html``.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from urllib.parse import quote, urlencode

from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.safestring import mark_safe

from . import blocks as blocks_engine

# --------------------------------------------------------------------------
AR_MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
]
AR_DAYS = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس",
           "الجمعة", "السبت", "الأحد"]


def format_event_date(value: dt.datetime | None, *, with_day: bool = True) -> str:
    if not value:
        return ""
    local = timezone.localtime(value) if timezone.is_aware(value) else value
    parts = []
    if with_day:
        parts.append(AR_DAYS[local.weekday()])
    parts.append(f"{local.day} {AR_MONTHS[local.month - 1]} {local.year}")
    return " — ".join(parts)


def format_event_time(value: dt.datetime | None) -> str:
    if not value:
        return ""
    local = timezone.localtime(value) if timezone.is_aware(value) else value
    hour = local.hour % 12 or 12
    suffix = "مساءً" if local.hour >= 12 else "صباحاً"
    minute = f":{local.minute:02d}" if local.minute else ""
    return f"{hour}{minute} {suffix}"


# --------------------------------------------------------------------------
def _px(value, fallback="0") -> str:
    if value in (None, ""):
        return fallback
    try:
        return f"{float(value):g}px"
    except (TypeError, ValueError):
        return fallback


def _hex_to_rgb(value: str) -> tuple[int, int, int] | None:
    if not isinstance(value, str):
        return None
    v = value.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6 or not re.fullmatch(r"[0-9a-fA-F]{6}", v):
        return None
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def rgba(color: str, alpha: float) -> str:
    rgb = _hex_to_rgb(color)
    if not rgb:
        return color or "transparent"
    return f"rgba({rgb[0]},{rgb[1]},{rgb[2]},{alpha:g})"


def theme_css_vars(theme: dict) -> str:
    """يبني متغيرات CSS من الثيم — كل شيء في الدعوة يقرأ منها."""
    accent = theme.get("accent") or "#b8914f"
    text = theme.get("text") or "#2c2620"
    shadow_map = {
        "none": "none",
        "soft": f"0 18px 48px -28px {rgba(text, 0.35)}",
        "strong": f"0 30px 70px -30px {rgba(text, 0.55)}",
    }
    scale = theme.get("font_scale") or 1.0
    try:
        scale = float(scale)
    except (TypeError, ValueError):
        scale = 1.0

    pairs = {
        "--bg": theme.get("bg") or "#f7f2ea",
        "--surface": theme.get("surface") or "#ffffff",
        "--text": text,
        "--muted": theme.get("muted") or "#7b6f62",
        "--accent": accent,
        "--accent-soft": theme.get("accent_soft") or "#e8d9be",
        "--accent-10": rgba(accent, 0.10),
        "--accent-20": rgba(accent, 0.20),
        "--accent-40": rgba(accent, 0.40),
        "--border": theme.get("border") or "#e3d9c9",
        "--font-heading": theme.get("font_heading") or "'Amiri', serif",
        "--font-body": theme.get("font_body") or "'Tajawal', sans-serif",
        "--font-scale": f"{scale:g}",
        "--letter-spacing": _px(theme.get("letter_spacing"), "0px"),
        "--radius": _px(theme.get("radius"), "14px"),
        "--max-width": _px(theme.get("max_width"), "720px"),
        "--section-gap": _px(theme.get("section_gap"), "0px"),
        "--shadow": shadow_map.get(theme.get("shadow"), shadow_map["soft"]),
        "--pattern-opacity": f"{(theme.get('pattern_opacity') or 0)}%",
        "--hero-overlay": f"{(theme.get('hero_overlay') or 0) / 100:g}",
        # وول بيبر الدعوة كلها. التعتيم بيتعمل بطبقة تدرّج في نفس خاصية
        # ‎background-image‎ مش بعنصر وهمي — العناصر الوهمية كانت هتتخانق
        # على ترتيب الطبقات مع النقشة ومع خلفيات الأقسام.
        "--doc-bg": _css_url(theme.get("bg_image")),
        "--doc-bg-veil": _veil(theme.get("bg_overlay")),
        "--doc-bg-attach": "fixed" if theme.get("bg_fixed") else "scroll",
    }
    return ";".join(f"{k}:{v}" for k, v in pairs.items())


def _css_url(value) -> str:
    """‎url("…")‎ آمنة جوّه خاصية style — أو ‎none‎ لو مفيش صورة.

    القيمة بتتحط في سمة ‎style‎ الأزواج فيها مفصولة بـ‎;‎، فأي علامة
    تنصيص أو فاصلة منقوطة في الرابط كانت هتكسر باقي المتغيّرات.
    """
    url = str(value or "").strip()
    if not url:
        return "none"
    # style="..." يستخدم علامات تنصيص مزدوجة، لذلك نستخدم المفردة
    # داخل url ونشفّرها لو جاءت من الرابط حتى لا تنكسر السمة.
    url = url.replace('"', "%22").replace("'", "%27").replace(";", "%3B").replace("\\", "")
    return f"url('{url}')"


def _veil(overlay) -> str:
    """طبقة سودا شفافة فوق صورة الخلفية — أو ‎none‎ لو التعتيم صفر."""
    try:
        pct = float(overlay or 0)
    except (TypeError, ValueError):
        pct = 0.0
    pct = max(0.0, min(90.0, pct))
    if not pct:
        return "none"
    a = f"{pct / 100:g}"
    return f"linear-gradient(rgba(0,0,0,{a}),rgba(0,0,0,{a}))"


def _intro_number(value, minimum: float, maximum: float, fallback: float = 0) -> float:
    """رقم آمن لإزاحة نص الافتتاحية، بعد تقييده داخل حدود المحرر."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    return max(minimum, min(maximum, number))


def intro_css(settings: dict) -> str:
    """يبني متغيرات CSS العامة الخاصة بالافتتاحية من إعدادات آمنة."""
    pairs = {
        "--intro-bg": _css_url(settings.get("intro_image")),
    }

    font = settings.get("intro_font") or ""
    allowed_fonts = {item["value"] for item in blocks_engine.FONT_CHOICES}
    if font in allowed_fonts:
        pairs["--intro-font"] = font

    return mark_safe(";".join(f"{key}:{value}" for key, value in pairs.items()))


def _intro_positions(settings: dict) -> dict:
    """يقرأ مواضع عناصر الافتتاحية مع تجاهل أي بيانات غير صالحة."""
    raw = settings.get("intro_item_positions")
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def intro_item_css(settings: dict, item: str) -> str:
    """يبني إزاحة عنصر واحد من عناصر الافتتاحية."""
    positions = _intro_positions(settings)
    value = positions.get(item) if isinstance(positions.get(item), dict) else {}
    x = _intro_number(value.get("x", settings.get("intro_text_x")), -35, 35)
    y = _intro_number(value.get("y", settings.get("intro_text_y")), -35, 35)
    pairs = [f"--intro-item-x:{x:g}vw", f"--intro-item-y:{y:g}vh"]
    color_keys = {
        "note": "intro_note_color",
        "guest_name": "intro_guest_name_color",
        "text": "intro_text_color",
        "button": "intro_button_color",
    }
    color = str(settings.get(color_keys.get(item, "")) or "").strip()
    if re.fullmatch(r"(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent)", color):
        pairs.append(f"--intro-item-color:{color}")
    return mark_safe(";".join(pairs))


def _fluid_px(value, fallback, ref) -> str:
    """نفس منطق فلتر fluid بس للاستعمال من بايثون."""
    from .templatetags.invite import _fluid
    try:
        n = float(str(value).strip() or fallback)
    except (TypeError, ValueError):
        n = fallback
    return _fluid(n, ref=ref, min_ratio=0.6)


def block_style_css(style: dict, theme: dict) -> str:
    """يبني الـinline style الخاص ببلوك واحد من حقول التنسيق المشتركة."""
    css: list[str] = []
    if style.get("bg_color"):
        css.append(f"--block-bg:{style['bg_color']}")
    if style.get("text_color"):
        css.append(f"--block-text:{style['text_color']}")
    if style.get("accent_color"):
        css.append(f"--accent:{style['accent_color']}")
        css.append(f"--accent-20:{rgba(style['accent_color'], 0.2)}")
    if style.get("bg_image"):
        url = str(style["bg_image"]).replace('"', "%22").replace("\\", "")
        css.append(f'--block-bg-image:url("{url}")')
    overlay = style.get("bg_overlay") or 0
    css.append(f"--block-overlay:{float(overlay) / 100:g}")
    # المسافات الرأسية بتتقاس مع عرض الدعوة زي الخطوط بالظبط — من غير كده
    # هتلاقي هوامش ٨٠px حوالين خط ٣٧px على التليفون.
    ref = theme.get("max_width") or 760
    css.append(f"--block-pt:{_fluid_px(style.get('padding_top'), 80, ref)}")
    css.append(f"--block-pb:{_fluid_px(style.get('padding_bottom'), 80, ref)}")
    css.append(f"--block-radius:{_px(style.get('radius'), '0px')}")
    align = style.get("align") or "center"
    css.append(f"--block-align:{align}")
    css.append(
        "--block-flex:"
        + {"right": "flex-end", "left": "flex-start", "center": "center"}.get(align, "center")
    )
    delay = style.get("animation_delay") or 0
    if delay:
        css.append(f"--anim-delay:{int(delay)}ms")
    return ";".join(css)


def block_classes(block: dict, theme: dict) -> str:
    style = block.get("style") or {}
    parts = [
        "lb",
        f"lb--{block['type']}",
        f"lb--w-{style.get('width') or 'normal'}",
    ]
    if style.get("bg_image"):
        parts.append("lb--has-bg")
    if style.get("bg_fixed"):
        parts.append("lb--bg-fixed")
    if theme.get("animations_enabled", True) and (style.get("animation") or "none") != "none":
        parts.append("lb-anim")
        parts.append(f"lb-anim--{style['animation']}")
    if style.get("custom_class"):
        safe = re.sub(r"[^a-zA-Z0-9_\- ]", "", str(style["custom_class"]))[:120]
        if safe:
            parts.append(safe)
    return " ".join(parts)


# --------------------------------------------------------------------------
# ربط البلوكات ببيانات الدعوة (الحقول التي تُملأ تلقائياً)
# --------------------------------------------------------------------------
def build_data_context(invitation) -> dict:
    """قيم بيانات المناسبة التي تستطيع البلوكات وراثتها."""
    if invitation is None:
        now = timezone.localtime() + dt.timedelta(days=45)
        return {
            "name_one": "ليلى", "name_two": "أحمد",
            "event_date": now,
            "date_text": format_event_date(now),
            "time_text": format_event_time(now),
            "venue": "قاعة الياسمين", "address": "القاهرة، مصر",
            "map_url": "", "whatsapp": "", "event_type": "زفاف",
            "slug": "preview", "public_url": "#",
        }
    return {
        "name_one": invitation.name_one,
        "name_two": invitation.name_two,
        "event_date": invitation.event_date,
        "date_text": format_event_date(invitation.event_date),
        "time_text": format_event_time(invitation.event_date),
        "venue": invitation.venue,
        "address": invitation.address,
        "map_url": invitation.map_url,
        "whatsapp": invitation.whatsapp,
        "event_type": invitation.event_type,
        "slug": invitation.slug,
        "public_url": "",
    }


AUTO_FIELD_MAP = {
    "date": "date_text",
    "time": "time_text",
    "venue": "venue",
    "address": "address",
}


def _resolve_props(block: dict, data: dict) -> dict:
    """يملأ الحقول الفارغة من بيانات الدعوة."""
    props = dict(block.get("props") or {})
    btype = block["type"]

    if btype == "hero":
        props["name_one"] = props.get("name_one") or data["name_one"]
        props["name_two"] = props.get("name_two") or data["name_two"]
        props["date_text"] = props.get("date_text") or data["date_text"]

    elif btype == "location":
        props["venue"] = props.get("venue") or data["venue"]
        props["address"] = props.get("address") or data["address"]
        props["map_link"] = props.get("map_link") or data["map_url"]

    elif btype == "details":
        rows = []
        for row in props.get("rows") or []:
            row = dict(row)
            auto = row.get("auto")
            if auto and not row.get("value"):
                row["value"] = data.get(AUTO_FIELD_MAP.get(auto, ""), "")
            rows.append(row)
        props["rows"] = rows

    return props


def _calendar_link(data: dict, title: str) -> str:
    start = data.get("event_date")
    if not start:
        return ""
    local = timezone.localtime(start) if timezone.is_aware(start) else start
    end = local + dt.timedelta(hours=4)
    fmt = "%Y%m%dT%H%M%S"
    params = {
        "action": "TEMPLATE",
        "text": title,
        "dates": f"{local.strftime(fmt)}/{end.strftime(fmt)}",
        "location": data.get("venue") or data.get("address") or "",
        "details": "دعوة رقمية",
    }
    return "https://calendar.google.com/calendar/render?" + urlencode(params)


# --------------------------------------------------------------------------
def _block_extras(block: dict, ctx: dict, invitation, editable: bool, guest=None) -> dict:
    """بيانات إضافية يحتاجها بلوك معيّن ولا تأتي من المستند."""
    btype = block["type"]
    props = ctx["props"]
    extras: dict = {}

    if btype == "rsvp":
        if invitation is not None and not editable:
            from django.urls import reverse
            extras["rsvp_action"] = reverse(
                "invitation_rsvp", kwargs={"slug": invitation.slug}
            )
        else:
            extras["rsvp_action"] = "#"

        # لما الضيف يفتح رابطه الشخصي: نملأ بياناته ونحدّ المرافقين بحصته
        # هو تحديداً، مش بالحد العام بتاع البلوك.
        if guest is not None:
            extras["guest"] = guest
            extras["guest_max_companions"] = min(
                int(props.get("max_companions") or 0), int(guest.plus_ones_allowed or 0)
            )
            extras["guest_answered"] = guest.latest_rsvp

        closed = False
        deadline = props.get("deadline")
        if deadline:
            try:
                day = dt.date.fromisoformat(str(deadline)[:10])
                closed = day < timezone.localdate()
            except ValueError:
                closed = False
        extras["rsvp_closed"] = closed

    elif btype == "wishes":
        wishes = []
        if invitation is not None:
            limit = int(props.get("limit") or 12)
            wishes = list(
                invitation.rsvps.filter(is_approved=True)
                .exclude(message="")
                .order_by("-created_at")[: max(1, min(100, limit))]
            )
        extras["wishes"] = wishes

    elif btype == "qr":
        from . import qrcodes
        target = ""
        if props.get("mode") == "checkin" and invitation is not None:
            target = ctx["data"].get("public_url") or ""
        else:
            target = ctx["data"].get("public_url") or ""
        extras["qr_svg"] = qrcodes.svg_for(target) if target else ""

    return extras


_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def layout_css(blocks: list[dict]) -> str:
    """قواعد CSS لإزاحات النصوص اللي المستخدم حرّكها بالماوس.

    بيتولّد على السيرفر عشان الموضع يبان من أول رسمة من غير ما يستنى JS
    (وإلا الضيف هيشوف النص بيطقّ من مكانه). القيم بوحدة cqw = نسبة من عرض
    المسرح، فالموضع بيتقاس مع الشاشة تلقائياً ومش محتاج نسخة لكل جهاز.
    """
    rules: list[str] = []
    for block in blocks:
        layout = block.get("layout") or {}
        bid = block.get("id") or ""
        if not layout or not _SAFE_ID.match(bid):
            continue
        for slot, pos in layout.items():
            if not _SAFE_ID.match(slot):
                continue
            dx, dy = pos.get("dx") or 0, pos.get("dy") or 0
            if not dx and not dy:
                continue
            rules.append(
                f'#{bid} [data-move="{slot}"]{{--dx:{dx}cqw;--dy:{dy}cqw}}'
            )
    # آمن بحكم البناء: المعرّفات متحققة بـ_SAFE_ID والأرقام float،
    # فمفيش أي مدخل من المستخدم بيوصل للناتج كنص حر.
    return mark_safe("".join(rules))


def render_document(
    document: dict,
    *,
    invitation=None,
    request=None,
    allowed_features: set[str] | None = None,
    editable: bool = False,
    guest=None,
    lang: str = "ar",
) -> dict:
    """يعرض المستند ويعيد ``{"html", "css_vars", "theme", "settings"}``."""
    doc = blocks_engine.normalize_document(document)

    # النسخة الإنجليزية نصوص مكتوبة بالإيد ومخزّنة جوّه المستند — مفيش
    # ترجمة آلية ولا استدعاء لأي خدمة برّه. أي مفتاح مش مترجم بيفضل
    # عربي: نص ناقص أحسن من فراغ في وش الضيف.
    has_en = blocks_engine.has_translation(doc, "en")
    lang = "en" if (lang == "en" and has_en) else "ar"

    theme = doc["theme"]
    doc_settings = doc["settings"]
    data = build_data_context(invitation)

    if lang == "en":
        doc = blocks_engine.apply_i18n(doc, "en")
        theme = doc["theme"]
        doc_settings = doc["settings"]
        data = blocks_engine.apply_i18n_data(data, doc, "en")
        # الإنجليزي بيتقرا من الشمال، والخطوط العربية محارفها اللاتينية
        # ناقصة — فبناخد خطوط النسخة الإنجليزية لو المصمّم حدّدها.
        theme["direction"] = "ltr"
        if theme.get("font_heading_en"):
            theme["font_heading"] = theme["font_heading_en"]
        if theme.get("font_body_en"):
            theme["font_body"] = theme["font_body_en"]

    if invitation is not None and request is not None:
        data["public_url"] = request.build_absolute_uri(invitation.get_absolute_url())

    title = " و ".join(n for n in [data["name_one"], data["name_two"]] if n)
    data["calendar_url"] = _calendar_link(data, f"{data['event_type']} {title}")
    data["whatsapp_share"] = (
        f"https://wa.me/?text={quote((data['public_url'] or '') + ' ' + title)}"
        if data["public_url"] else ""
    )

    countdown_iso = ""
    if data.get("event_date"):
        ev = data["event_date"]
        countdown_iso = (timezone.localtime(ev) if timezone.is_aware(ev) else ev).isoformat()

    chunks: list[str] = []
    for block in doc["blocks"]:
        spec = blocks_engine.BLOCK_REGISTRY.get(block["type"])
        if not spec:
            continue

        gated = bool(
            allowed_features is not None
            and spec["feature"]
            and spec["feature"] not in allowed_features
        )
        hidden = (not block.get("visible", True)) or gated

        if hidden and not editable:
            continue  # لا يصل للضيف أصلاً

        ctx = {
            "block": block,
            "props": _resolve_props(block, data),
            "style": block.get("style") or {},
            "theme": theme,
            "settings": doc_settings,
            "data": data,
            "invitation": invitation,
            "countdown_iso": countdown_iso,
            "editable": editable,
            "hidden": hidden,
            "gated": gated,
            "css": block_style_css(block.get("style") or {}, theme),
            "classes": block_classes(block, theme),
            "allowed_features": allowed_features or set(),
            "request": request,
        }
        ctx["guest"] = guest
        ctx.update(_block_extras(block, ctx, invitation, editable, guest))
        chunks.append(render_to_string(f"blocks/{block['type']}.html", ctx, request=request))

    return {
        "html": mark_safe("".join(chunks)),
        "css_vars": theme_css_vars(theme),
        "intro_css": intro_css(doc_settings),
        "intro_item_styles": {
            item: intro_item_css(doc_settings, item)
            for item in ("note", "guest_name", "text", "button")
        },
        "layout_css": layout_css(doc["blocks"]),
        "theme": theme,
        "settings": doc_settings,
        "data": data,
        "countdown_iso": countdown_iso,
        "block_count": len(doc["blocks"]),
        # القالب بيقرر ظهور زرار اللغة من دول: مفيش نسخة = مفيش زرار.
        "lang": lang,
        "has_en": has_en,
    }
