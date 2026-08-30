"""وسوم قوالب مساعدة لعرض الدعوات."""

from __future__ import annotations

import os
import re
from html import escape

from django import template
from django.conf import settings

from django.utils.safestring import mark_safe

from ..cssscope import scope_css
from ..sanitize import clean_html

register = template.Library()

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_VIDEO_ATTR_RE = re.compile(
    r'((?:src|poster)\s*=\s*["\'])(/media/[^"\']+\.(?:mp4|m4v|mov|webm|ogv)(?:\?[^"\']*)?)(["\'])',
    re.I,
)


# --------------------------------------------------------------------------
# الزخارف الفاصلة
# --------------------------------------------------------------------------
_ORNAMENTS = {
    "line": (
        '<svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">'
        '<line x1="0" y1="6" x2="200" y2="6" stroke="currentColor" stroke-width="1"/>'
        "</svg>"
    ),
    "diamond": (
        '<svg viewBox="0 0 200 16" aria-hidden="true">'
        '<line x1="0" y1="8" x2="86" y2="8" stroke="currentColor" stroke-width="1"/>'
        '<path d="M100 2 L108 8 L100 14 L92 8 Z" fill="currentColor"/>'
        '<line x1="114" y1="8" x2="200" y2="8" stroke="currentColor" stroke-width="1"/>'
        "</svg>"
    ),
    "dots": (
        '<svg viewBox="0 0 200 12" aria-hidden="true">'
        '<circle cx="88" cy="6" r="2" fill="currentColor"/>'
        '<circle cx="100" cy="6" r="3" fill="currentColor"/>'
        '<circle cx="112" cy="6" r="2" fill="currentColor"/>'
        "</svg>"
    ),
    "floral": (
        '<svg viewBox="0 0 200 28" aria-hidden="true">'
        '<path d="M20 14 C50 4 70 24 100 14 C130 4 150 24 180 14" fill="none" '
        'stroke="currentColor" stroke-width="1"/>'
        '<path d="M100 8 C104 12 104 16 100 20 C96 16 96 12 100 8 Z" fill="currentColor"/>'
        '<circle cx="74" cy="14" r="1.8" fill="currentColor"/>'
        '<circle cx="126" cy="14" r="1.8" fill="currentColor"/>'
        "</svg>"
    ),
    "arabesque": (
        '<svg viewBox="0 0 200 30" aria-hidden="true">'
        '<path d="M100 4 C112 12 112 18 100 26 C88 18 88 12 100 4 Z" fill="none" '
        'stroke="currentColor" stroke-width="1"/>'
        '<path d="M100 9 C106 13 106 17 100 21 C94 17 94 13 100 9 Z" fill="currentColor" '
        'opacity=".55"/>'
        '<path d="M8 15 C34 5 56 25 82 15" fill="none" stroke="currentColor" stroke-width="1"/>'
        '<path d="M118 15 C144 5 166 25 192 15" fill="none" stroke="currentColor" stroke-width="1"/>'
        "</svg>"
    ),
}


@register.simple_tag
def ornament(variant: str, size: int | str = 40):
    """يرسم زخرفة فاصلة كـSVG مضمّن."""
    svg = _ORNAMENTS.get(variant or "")
    if not svg:
        return ""
    try:
        px = max(10, min(400, int(float(size))))
    except (TypeError, ValueError):
        px = 40
    return mark_safe(
        f'<div class="lb-ornament lb-ornament--{variant}" '
        f'style="--orn-size:{px}px" aria-hidden="true">{svg}</div>'
    )


# --------------------------------------------------------------------------
# الأيقونات
# --------------------------------------------------------------------------
_ICONS = {
    "calendar": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "pin": '<path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
    "heart": '<path d="M12 20s-7.5-4.7-7.5-9.7A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 3.3C19.5 15.3 12 20 12 20Z"/>',
    "ring": '<circle cx="12" cy="14" r="6"/><path d="M9 6h6l-3 4Z"/>',
    "gift": '<rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M3 13h18M12 9v12M8.5 9a2.5 2.5 0 1 1 2-4c1 1.3 1.5 2.6 1.5 4M15.5 9a2.5 2.5 0 1 0-2-4c-1 1.3-1.5 2.6-1.5 4"/>',
    "phone": '<path d="M6 3h3l2 5-2.2 1.4a12 12 0 0 0 5.8 5.8L16 13l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3Z"/>',
    "star": '<path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.8 6.6 19.7l1.2-6.1L3.3 9.4l6.1-.8Z"/>',
    "music": '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    "camera": '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M9 7l1.5-2h3L15 7"/>',
    "cake": '<path d="M4 20h16v-6a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3Z"/><path d="M12 8V5M8.5 8V6M15.5 8V6"/>',
    "car": '<path d="M4 16h16v-3l-2-5H6l-2 5Z"/><circle cx="7.5" cy="18" r="1.6"/><circle cx="16.5" cy="18" r="1.6"/>',
    "dress": '<path d="M9 3h6l-1 4 4 10-2 4H8l-2-4 4-10Z"/>',
    "info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
}


@register.simple_tag
def icon(name: str, size: int | str = 22):
    body = _ICONS.get(name or "")
    if not body:
        return ""
    try:
        px = max(10, min(96, int(float(size))))
    except (TypeError, ValueError):
        px = 22
    return mark_safe(
        f'<svg class="lb-icon" width="{px}" height="{px}" viewBox="0 0 24 24" '
        f'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" '
        f'stroke-linejoin="round" aria-hidden="true">{body}</svg>'
    )


@register.simple_tag
def icon_names():
    return list(_ICONS.keys())


# --------------------------------------------------------------------------
# أيقونات السوشيال — لقسم الدعاية
# --------------------------------------------------------------------------
# مرسومة هنا كـSVG مضمّن مش صور: اللون بيتغيّر من المحرر عن طريق
# ‎currentColor‎، ومفيش طلب شبكة زيادة على الدعوة.
_SOCIAL_ICONS = {
    "whatsapp": (
        '<path fill="currentColor" d="M12 2a9.9 9.9 0 0 0-8.5 15l-1.3 4.8 '
        '4.9-1.3A9.9 9.9 0 1 0 12 2zm0 1.8a8.1 8.1 0 1 1-4.2 15l-.3-.2-2.9.8'
        '.8-2.8-.2-.3A8.1 8.1 0 0 1 12 3.8zm-3.4 4c-.2 0-.5.1-.7.4-.2.3-.9.9'
        '-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.7 4.2 3.7 2.1.8 2.5.7 3 .6.5-.1 '
        '1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.6-.3s-1.4-.7-1.6-.8c-.2-.1-.4-.1'
        '-.5.1l-.7.9c-.1.2-.3.2-.5.1-.2-.1-1-.4-2-1.2-.7-.6-1.2-1.4-1.4-1.7'
        '-.1-.2 0-.3.1-.4l.4-.5.3-.5v-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.4z"/>'
    ),
    "facebook": (
        '<path fill="currentColor" d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12'
        'h2.5V9.8c0-2.5 1.5-3.9 3.7-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0'
        '-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/>'
    ),
    "instagram": (
        '<rect x="3" y="3" width="18" height="18" rx="5.2" fill="none" '
        'stroke="currentColor" stroke-width="1.9"/>'
        '<circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" '
        'stroke-width="1.9"/>'
        '<circle cx="17.2" cy="6.8" r="1.25" fill="currentColor"/>'
    ),
}

# الروابط اللي بتوصل الضيف لحتة تانية. أي حاجة غير كده مابتتكتبش أصلاً.
_SOCIAL_HREF_RE = re.compile(r"^(?:https?://|mailto:|tel:)[^\s\"<>]{1,600}$", re.I)


@register.simple_tag
def social_link(name, url, color, size=34):
    """أيقونة سوشيال واحدة — ومعاها رابطها ولونها.

    كل حاجة بتتفحص هنا قبل ما تدخل الصفحة: الاسم لازم يكون من القايمة،
    الرابط لازم يبدأ بـ‎http(s)‎ أو ‎mailto‎ أو ‎tel‎ (يعني ‎javascript:‎
    مابيعديش)، واللون لازم يبقى لون CSS صالح. الأيقونة من غير رابط
    بتتعرض من غير ما تبقى لينك بدل ‎href="#"‎ اللي بيرجّع الضيف لفوق.
    """
    body = _SOCIAL_ICONS.get(str(name or "").strip())
    if not body:
        return ""
    try:
        px = max(14, min(120, int(float(size))))
    except (TypeError, ValueError):
        px = 34
    hue = str(color or "").strip()
    if not re.fullmatch(r"#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)", hue):
        hue = "currentColor"
    svg = (
        f'<svg class="lb-social-icon" width="{px}" height="{px}" '
        f'viewBox="0 0 24 24" aria-hidden="true">{body}</svg>'
    )
    href = str(url or "").strip()
    label = escape(str(name).strip())
    if _SOCIAL_HREF_RE.match(href):
        return mark_safe(
            f'<a class="lb-social" href="{escape(href)}" target="_blank" '
            f'rel="noopener" aria-label="{label}" '
            f'style="color:{hue}">{svg}</a>'
        )
    return mark_safe(
        f'<span class="lb-social" aria-label="{label}" '
        f'style="color:{hue}">{svg}</span>'
    )


# --------------------------------------------------------------------------
def _route_video_url(value):
    value = str(value or "")
    base = str(getattr(settings, "MEDIA_URL", "/media/") or "/media/")
    if not base.endswith("/"):
        base += "/"
    path, sep, query = value.partition("?")
    if path.startswith(base) and os.path.splitext(path)[1].lower() in {".mp4", ".m4v", ".webm", ".ogv"}:
        value = "/media-video/" + path[len(base):].lstrip("/")
        if sep:
            value += "?" + query
    return value


@register.filter(name="safe_html")

def safe_html(value, max_length=20000):
    """ينقّي HTML قبل عرضه؛ الصفر/None يتيحان قسماً كبيراً من غير قص."""
    cleaned = clean_html(value or "", max_length=max_length)
    # يشمل القوالب القديمة التي حُفظت قبل إضافة endpoint الـRange.
    cleaned = _VIDEO_ATTR_RE.sub(
        lambda m: m.group(1) + _route_video_url(m.group(2)) + m.group(3), cleaned
    )
    return mark_safe(cleaned)


@register.filter(name="safe_css")
def safe_css(value, block_id=""):
    """يحصر ستايل القسم المستورد جوّه القسم نفسه — وقت العرض.

    الحصر بيتعمل هنا مش وقت الاستيراد عن قصد: المخزَّن يفضل CSS الأصلي
    اللي تقدر تقراه وتعدّله من المحرر، والحصر (اللي هو حدود الأمان)
    بيتطبّق على كل عرض، فمستند اتعدّل بالإيد مايقدرش يكسر باقي الصفحة.
    """
    if not value:
        return ""
    bid = str(block_id or "").strip()
    scope = f"#{bid}" if _SAFE_ID.match(bid) else ".lb-custom"
    return mark_safe(scope_css(str(value), scope))


@register.filter(name="video_url")
def video_url(value):
    """يوجّه فيديوهات media المحلية إلى المسار الداعم للتحميل الجزئي."""
    value = str(value or "")
    base = str(getattr(settings, "MEDIA_URL", "/media/") or "/media/")
    if not base.endswith("/"):
        base += "/"
    path, sep, query = value.partition("?")
    if path.startswith(base) and os.path.splitext(path)[1].lower() in {".mp4", ".m4v", ".webm", ".ogv"}:
        value = "/media-video/" + path[len(base):].lstrip("/")
        if sep:
            value += "?" + query
    return value


_OVL_COLOR_RE = re.compile(r"#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent")
_OVL_FONT_RE = re.compile(r"[A-Za-z0-9_\s,'-]+")


def _ovl_num(item, key, low, high, fallback=0.0):
    try:
        return max(low, min(high, float(item.get(key, 0) or 0)))
    except (TypeError, ValueError):
        return fallback


def _ovl_color(item, key, fallback):
    value = str(item.get(key) or "").strip()
    return value if _OVL_COLOR_RE.fullmatch(value) else fallback


def _ovl_font(item, key):
    value = str(item.get(key) or "").strip()
    if not value or len(value) > 120 or not _OVL_FONT_RE.fullmatch(value):
        return "inherit"
    return value


@register.filter
def video_text_style(item):
    """متغيرات CSS آمنة لعنصر واحد فوق القسم — نص أو صورة أو زرار.

    كل قيمة بتتفحص هنا قبل ما تدخل سمة ``style``: اللون لازم يطابق
    شكل لون CSS، والخط محارف مسموحة بس، والأرقام داخل حدود حقولها.
    يعني مفيش نص حر جاي من المحرر بيوصل للصفحة.
    """
    item = item if hasattr(item, "get") else {}
    x = _ovl_num(item, "x", -1000.0, 1000.0)
    y = _ovl_num(item, "y", -1000.0, 1000.0)
    color = _ovl_color(item, "color", "#ffffff")
    font = _ovl_font(item, "font")
    # عرض الصندوق كنسبة من القسم. صفر = تلقائي.
    # من غير عرض ثابت، العرض بيتحسب من المسافة بين ‎left‎ وحافة القسم،
    # يعني بيتغيّر كل ما العنصر يتحرك يمين أو شمال والكلام بيعيد التفاف.
    width = _ovl_num(item, "width", 0.0, 100.0)
    # حجم النص من ترس النص. صفر = حجم القالب زي ما هو. بيمشي بـ‎_fluid‎
    # زي باقي المقاسات في الدعوة عشان يصغّر مع الشاشة بدل ما يفضل ثابت.
    size = _ovl_num(item, "size", 0.0, 160.0)
    style = (
        f"--video-text-x:{x:g}%;--video-text-y:{y:g}%;"
        f"--video-text-color:{color};--video-text-font:{font}"
    )
    if width > 0:
        style += f";--section-text-w:{width:g}%"
    if size > 0:
        style += f";--section-text-size:{_fluid(size)}"

    kind = str(item.get("kind") or "text")
    if kind == "image":
        radius = _ovl_num(item, "radius", 0.0, 200.0)
        style += f";--ovl-radius:{radius:g}px"
    elif kind == "button":
        btn_size = _ovl_num(item, "btn_size", 0.0, 120.0)
        style += (
            f";--ovl-btn-bg:{_ovl_color(item, 'btn_bg', '#b8914f')}"
            f";--ovl-btn-color:{_ovl_color(item, 'btn_color', '#ffffff')}"
            f";--ovl-btn-font:{_ovl_font(item, 'btn_font')}"
            f";--ovl-btn-radius:{_ovl_num(item, 'btn_radius', 0.0, 999.0, 999.0):g}px"
        )
        if btn_size > 0:
            style += f";--ovl-btn-size:{_fluid(btn_size)}"
    return mark_safe(style)


@register.filter
def overlay_target(href):
    """‎_blank‎ للروابط الخارجية بس.

    رابط داخل نفس الصفحة (‎#rsvp‎) لو اتفتح في تبويب جديد بيفتح نسخة
    تانية من الدعوة بدل ما ينزّل الضيف للقسم.
    """
    return "_blank" if str(href or "").strip().lower().startswith(
        ("http://", "https://", "mailto:", "tel:")) else ""


@register.filter
def get(mapping, key):
    if hasattr(mapping, "get"):
        return mapping.get(key, "")
    return ""


@register.simple_tag
def button_href(action, target, data):
    """يحوّل إعداد الزر إلى رابط فعلي."""
    action = action or "scroll"
    if action == "link":
        return target or "#"
    if action == "scroll":
        return target if (target or "").startswith("#") else f"#{target or ''}"
    if action == "rsvp":
        return "#rsvp"
    if action == "map":
        return data.get("map_url") or "#"
    if action == "calendar":
        return data.get("calendar_url") or "#"
    if action == "whatsapp":
        num = (data.get("whatsapp") or "").replace("+", "").replace(" ", "")
        return f"https://wa.me/{num}" if num else "#"
    if action == "share":
        return data.get("whatsapp_share") or "#"
    return "#"


# ---------------------------------------------------------------- المقاسات المرنة
# المستخدم بيظبط المقاس مرة واحدة على الديسكتوب، والمقاس بيتقلّص لوحده على
# التابلت والتليفون. البديل — حقل مقاس لكل جهاز لكل عنصر — معناه ٣ أضعاف
# الحقول و٣ أضعاف فرص إن المستخدم ينسى واحد فيهم.
FLUID_REF = 760          # عرض المسرح المرجعي اللي المقاس اتظبط عليه


@register.filter
def fluid(value, ref=None):
    """px ثابت → clamp() بيتقاس مع عرض الدعوة.

    ``{{ props.name_size|fluid:theme.max_width }}`` بترجّع مثلاً
    ``clamp(37.4px, 9.474cqw, 72px)`` — نفس المقاس على الشاشة الكبيرة،
    وبيصغر بالتناسب لحد نص المقاس على التليفون.
    """
    return _fluid(value, ref=ref)


@register.filter
def fluid_min(value, floor):
    """زي fluid بس الحد الأدنى بيجي من المستخدم (حقل مقاس الموبايل)."""
    return _fluid(value, floor=floor)


def _fluid(value, *, ref=None, floor=None, min_ratio=0.52):
    try:
        size = float(str(value).strip() or 0)
    except (TypeError, ValueError):
        return "0px"
    if size <= 0:
        return "0px"

    try:
        reference = float(str(ref).strip() or 0) or FLUID_REF
    except (TypeError, ValueError):
        reference = FLUID_REF

    try:
        low = float(str(floor).strip() or 0) if floor is not None else 0.0
    except (TypeError, ValueError):
        low = 0.0
    if low <= 0:
        low = size * min_ratio
    low = min(low, size)                 # الحد الأدنى مايزيدش عن الأصلي

    preferred = size / reference * 100
    return f"clamp({round(low, 1)}px, {round(preferred, 3)}cqw, {round(size, 1)}px)"
